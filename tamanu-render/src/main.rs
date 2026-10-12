use std::io::Read;
use std::path::PathBuf;

use anyhow::{Context, Result};
use clap::Parser;

use tamanu_render::params::Params;

/// Renders a Tamanu deployment to manifests on stdout.
///
/// Parameters are one JSON document, read from `--params`, from the
/// `ARGOCD_ENV_PARAMS` variable an Argo plugin Application provides, or from
/// stdin.
#[derive(Parser)]
struct Args {
	/// Read the parameters from this file, or `-` for stdin.
	#[arg(long)]
	params: Option<PathBuf>,

	/// Output format.
	#[arg(long, value_enum, default_value_t = Format::Yaml)]
	format: Format,
}

#[derive(Clone, Copy, clap::ValueEnum)]
enum Format {
	/// A multi-document YAML stream, as Argo expects from a plugin.
	Yaml,
	/// One JSON array, for diffing and tooling.
	Json,
}

fn main() -> Result<()> {
	let args = Args::parse();
	let raw = match (&args.params, std::env::var("ARGOCD_ENV_PARAMS")) {
		(Some(path), _) if path.as_os_str() == "-" => read_stdin()?,
		(Some(path), _) => {
			std::fs::read_to_string(path).with_context(|| format!("reading {}", path.display()))?
		}
		(None, Ok(value)) => value,
		(None, Err(_)) => read_stdin()?,
	};
	let params: Params = serde_json::from_str(&raw).context("parsing parameters")?;
	let resources = tamanu_render::render(&params)?;
	match args.format {
		Format::Yaml => print!("{}", tamanu_render::to_yaml(&resources)?),
		Format::Json => println!("{}", serde_json::to_string_pretty(&resources)?),
	}
	Ok(())
}

fn read_stdin() -> Result<String> {
	let mut s = String::new();
	std::io::stdin().read_to_string(&mut s)?;
	Ok(s)
}
