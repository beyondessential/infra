//! Performance tuning for CNPG clusters, derived from the resources each
//! cluster is given. Ported from `postgresTuning.ts`, which follows the pgtune
//! algorithm for a Linux OLTP workload on SSD storage.
//!
//! The basis is the pod's whole memory request, since an instance pod runs
//! nothing but PostgreSQL.
//!
//! Memory values are computed in kB and emitted with an explicit `kB` suffix:
//! several of these settings have their own default unit (`shared_buffers`
//! counts 8kB blocks, `max_slot_wal_keep_size` counts MB), so a unit-less
//! integer would mean something different per parameter.
//!
//! Two settings the Ansible role tunes are absent on purpose. `huge_pages`
//! needs pages preallocated on the node and requested as a pod resource, and
//! neither is provisioned. `io_method=io_uring` needs syscalls the default
//! containerd seccomp profile blocks, and would buy nothing since volumes serve
//! reads from the node page cache almost entirely.

use std::collections::BTreeMap;

use anyhow::{Result, anyhow, bail};

const KB: u64 = 1;
const MB: u64 = 1024 * KB;
const GB: u64 = 1024 * MB;

/// pgtune divides the non-shared_buffers memory across connections plus the
/// worker processes a backend may recruit. That falls back to this default
/// when parallel settings are not emitted, as here: nothing is derived from CPU
/// counts.
const WORKERS_FOR_WORK_MEM: u64 = 8;

/// PostgreSQL's own default, and the floor tuning must not go under.
const MAINTENANCE_WORK_MEM_DEFAULT: u64 = 64 * MB;

fn unit_multiplier(unit: &str) -> Option<f64> {
	Some(match unit {
		"" => 1.0,
		"k" => 1e3,
		"M" => 1e6,
		"G" => 1e9,
		"T" => 1e12,
		"P" => 1e15,
		"Ki" => 1024.0,
		"Mi" => 1024.0_f64.powi(2),
		"Gi" => 1024.0_f64.powi(3),
		"Ti" => 1024.0_f64.powi(4),
		"Pi" => 1024.0_f64.powi(5),
		_ => return None,
	})
}

/// Kubernetes resource quantities carry their unit, and a cluster's memory and
/// storage are written in whichever one suits. Parsing rather than assuming a
/// unit keeps `500Mi` from being read as 500GiB.
pub fn parse_quantity_to_bytes(quantity: &str) -> Result<f64> {
	let q = quantity.trim();
	let split = q
		.find(|c: char| !(c.is_ascii_digit() || c == '.'))
		.unwrap_or(q.len());
	let (number, unit) = q.split_at(split);
	let unit = unit.trim_start();

	let well_formed = {
		let mut parts = number.splitn(2, '.');
		let whole = parts.next().unwrap_or("");
		let fraction = parts.next();
		!whole.is_empty()
			&& whole.bytes().all(|b| b.is_ascii_digit())
			&& fraction.is_none_or(|f| !f.is_empty() && f.bytes().all(|b| b.is_ascii_digit()))
			&& unit.bytes().all(|b| b.is_ascii_alphabetic())
	};
	if !well_formed {
		bail!("unparseable Kubernetes quantity: {quantity}");
	}
	let multiplier = unit_multiplier(unit)
		.ok_or_else(|| anyhow!("unknown unit {unit} in Kubernetes quantity: {quantity}"))?;
	let value: f64 = number
		.parse()
		.map_err(|_| anyhow!("unparseable Kubernetes quantity: {quantity}"))?;
	Ok(value * multiplier)
}

pub struct TuningArgs<'a> {
	/// Memory request of the instance pods, as a Kubernetes quantity.
	pub memory: &'a str,
	/// Volume size of the cluster, as a Kubernetes quantity.
	pub storage: &'a str,
	pub max_connections: u32,
}

pub fn derive_postgres_parameters(args: TuningArgs<'_>) -> Result<BTreeMap<String, String>> {
	let ram = (parse_quantity_to_bytes(args.memory)? / 1024.0).floor() as u64;
	let volume = (parse_quantity_to_bytes(args.storage)? / 1024.0).floor() as u64;
	let max_connections = u64::from(args.max_connections);

	let shared_buffers = ram / 4;
	let effective_cache_size = ram * 3 / 4;

	// A sixteenth of the basis falls below PostgreSQL's own default on the
	// smaller clusters, where it would slow vacuums and index builds rather
	// than tune them.
	let maintenance_work_mem = MAINTENANCE_WORK_MEM_DEFAULT.max((ram / 16).min(8 * GB));

	let work_mem =
		(4 * MB).max((ram - shared_buffers) / ((max_connections + WORKERS_FOR_WORK_MEM) * 3));

	let mut p = BTreeMap::new();
	let mut set = |k: &str, v: String| {
		p.insert(k.to_owned(), v);
	};

	// Pinned rather than left implicit because work_mem is divided by it: the
	// two have to agree on the same number.
	set("max_connections", max_connections.to_string());
	set("shared_buffers", format!("{shared_buffers}kB"));
	set("effective_cache_size", format!("{effective_cache_size}kB"));
	set("maintenance_work_mem", format!("{maintenance_work_mem}kB"));
	set("work_mem", format!("{work_mem}kB"));
	set(
		"wal_buffers",
		format!("{}kB", derive_wal_buffers(shared_buffers)),
	);

	// Per-session cap, so a query spilling temp files cannot fill the volume
	// out from under the cluster.
	set("temp_file_limit", format!("{}kB", volume / 4));

	// Replication slots retain WAL without bound by default, so a stranded or
	// long-lagging standby would fill the primary's volume. A replica that
	// falls further behind than this is re-cloned by CNPG instead.
	let slot_keep = GB.max((volume as f64 * 0.3).floor() as u64);
	set("max_slot_wal_keep_size", format!("{slot_keep}kB"));

	// gp3 is SSD-class: seeks are nearly as cheap as sequential reads, and it
	// has queue depth to exploit.
	set("random_page_cost", "1.1".into());
	set("effective_io_concurrency", "200".into());

	// JIT causes CPU spikes and slow planning on simple OLTP queries.
	set("jit", "off".into());

	// Roughly halves WAL volume on full-page-write-heavy churn, which shrinks
	// replication traffic, pg_wal I/O and backup sizes.
	set("wal_compression", "lz4".into());

	// A backend blocked on a lock does not otherwise notice its client left until
	// it next writes to it; behind PgBouncer, which reopens the server connection
	// straight away, those orphans pile up until slots run out.
	set("client_connection_check_interval", "10s".into());
	set("log_lock_waits", "on".into());

	// Above 2GB, maintenance_work_mem is more than any one autovacuum worker
	// should claim; below it, tracking maintenance_work_mem is the right default.
	if maintenance_work_mem >= 2 * GB {
		set("autovacuum_work_mem", format!("{}kB", 2 * GB));
	}

	Ok(p)
}

/// 3% of shared_buffers, bounded to [32kB, 16MB]. The window just under the
/// upper bound rounds up instead: pgtune treats a value that close to 16MB as
/// wanting the cap.
fn derive_wal_buffers(shared_buffers: u64) -> u64 {
	let raw = shared_buffers * 3 / 100;
	if raw > 14 * MB && raw < 16 * MB {
		return 16 * MB;
	}
	(32 * KB).max((16 * MB).min(raw))
}

#[cfg(test)]
mod tests {
	use super::*;

	const MIB: u64 = 1024;
	const GIB: u64 = 1024 * MIB;

	fn derive(memory: &str, storage: &str, max_connections: u32) -> BTreeMap<String, String> {
		derive_postgres_parameters(TuningArgs {
			memory,
			storage,
			max_connections,
		})
		.unwrap()
	}

	#[test]
	fn memory_parameters_scale_with_the_basis() {
		for (memory, conns, shared, work) in [
			("750Mi", 100, 187 * MIB + 512, 4 * MIB),
			("2Gi", 200, 512 * MIB, 4 * MIB),
			("8Gi", 200, 2 * GIB, 10082),
		] {
			let p = derive(memory, "60Gi", conns);
			assert_eq!(p["shared_buffers"], format!("{shared}kB"), "{memory}");
			assert_eq!(p["effective_cache_size"], format!("{}kB", shared * 3));
			assert_eq!(p["work_mem"], format!("{work}kB"), "{memory}");
			assert_eq!(p["max_connections"], conns.to_string());
		}
	}

	#[test]
	fn maintenance_work_mem_is_a_sixteenth_but_never_below_the_default() {
		assert_eq!(
			derive("750Mi", "10Gi", 100)["maintenance_work_mem"],
			format!("{}kB", 64 * MIB)
		);
		assert_eq!(
			derive("2Gi", "10Gi", 100)["maintenance_work_mem"],
			format!("{}kB", 128 * MIB)
		);
		assert_eq!(
			derive("256Gi", "10Gi", 100)["maintenance_work_mem"],
			format!("{}kB", 8 * GIB)
		);
	}

	#[test]
	fn work_mem_is_floored_at_4mb() {
		assert_eq!(derive("8Gi", "10Gi", 200)["work_mem"], "10082kB");
		assert_eq!(
			derive("8Gi", "10Gi", 1000)["work_mem"],
			format!("{}kB", 4 * MIB)
		);
	}

	#[test]
	fn wal_buffers_are_bounded_and_snap_near_the_cap() {
		assert_eq!(derive("750Mi", "10Gi", 100)["wal_buffers"], "5760kB");
		assert_eq!(derive("1866Mi", "10Gi", 100)["wal_buffers"], "14330kB");
		assert_eq!(
			derive("2Gi", "10Gi", 100)["wal_buffers"],
			format!("{}kB", 16 * MIB)
		);
		assert_eq!(
			derive("8Gi", "10Gi", 100)["wal_buffers"],
			format!("{}kB", 16 * MIB)
		);
	}

	#[test]
	fn autovacuum_work_mem_only_from_2gb_maintenance() {
		assert!(!derive("8Gi", "10Gi", 100).contains_key("autovacuum_work_mem"));
		assert_eq!(
			derive("32Gi", "10Gi", 100)["autovacuum_work_mem"],
			format!("{}kB", 2 * GIB)
		);
	}

	#[test]
	fn volume_parameters_follow_the_storage_size() {
		let large = derive("750Mi", "60Gi", 100);
		assert_eq!(large["temp_file_limit"], format!("{}kB", 15 * GIB));
		assert_eq!(large["max_slot_wal_keep_size"], format!("{}kB", 18 * GIB));
		let small = derive("750Mi", "2Gi", 100);
		assert_eq!(small["max_slot_wal_keep_size"], format!("{}kB", GIB));
	}

	#[test]
	fn fixed_workload_assumptions_and_absent_parameters() {
		for memory in ["750Mi", "8Gi"] {
			let p = derive(memory, "10Gi", 100);
			assert_eq!(p["random_page_cost"], "1.1");
			assert_eq!(p["effective_io_concurrency"], "200");
			assert_eq!(p["jit"], "off");
			assert_eq!(p["wal_compression"], "lz4");
			assert_eq!(p["client_connection_check_interval"], "10s");
			assert_eq!(p["log_lock_waits"], "on");
		}
		let p = derive("32Gi", "60Gi", 200);
		for absent in [
			"huge_pages",
			"io_method",
			"io_workers",
			"max_worker_processes",
			"max_parallel_workers",
			"max_parallel_workers_per_gather",
			"max_parallel_maintenance_workers",
		] {
			assert!(!p.contains_key(absent), "{absent} must not be set");
		}
	}

	#[test]
	fn quantities_are_parsed_by_their_declared_unit() {
		let bytes = |q| parse_quantity_to_bytes(q).unwrap();
		assert_eq!(bytes("750Mi"), 750.0 * 1024.0 * 1024.0);
		assert_eq!(bytes("8Gi"), 8.0 * 1024.0_f64.powi(3));
		assert_eq!(bytes("1G"), 1e9);
		assert_eq!(bytes("1Ki"), 1024.0);
		assert_eq!(bytes("4096"), 4096.0);
		assert_eq!(bytes("1.5Gi"), 1.5 * 1024.0_f64.powi(3));
		assert_ne!(bytes("500Mi"), bytes("500Gi"));

		let err = |q| parse_quantity_to_bytes(q).unwrap_err().to_string();
		assert!(err("banana").contains("unparseable"));
		assert!(err("5Xi").contains("unknown unit"));
		assert!(err("").contains("unparseable"));
		assert!(err("1.Gi").contains("unparseable"));
	}
}
