use std::io::Read;
use std::path::PathBuf;

use anyhow::{Context, Result};
use clap::Parser;

use tamanu_renderer::UnknownConfigKeys;
use tamanu_renderer::params::Params;

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

	/// Read config templates from this directory instead of the ones built in.
	#[arg(long)]
	templates: Option<PathBuf>,

	/// Output format.
	#[arg(long, value_enum, default_value_t = Format::Stream)]
	format: Format,

	/// What to do with a stack config key this renderer does not know. Set on a plugin sidecar
	/// through the environment, since the same arguments run on every channel's image.
	#[arg(
		long,
		env = "RENDERER_UNKNOWN_CONFIG_KEYS",
		value_enum,
		default_value_t = UnknownConfigKeys::Reject
	)]
	unknown_config_keys: UnknownConfigKeys,
}

#[derive(Clone, Copy, clap::ValueEnum)]
enum Format {
	/// A multi-document YAML stream, for reading.
	Yaml,
	/// A stream of JSON documents separated by `---`, as the Argo plugin emits.
	Stream,
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
	let unknown = params.config.unknown_keys();
	if !unknown.is_empty() && args.unknown_config_keys == UnknownConfigKeys::Ignore {
		eprintln!("ignoring unknown config key(s): {}", unknown.join(", "));
	}
	let options = tamanu_renderer::Options {
		templates: args.templates.clone(),
		unknown_config_keys: args.unknown_config_keys,
	};
	let resources = tamanu_renderer::render_with(&params, &options)?;
	match args.format {
		Format::Yaml => print!("{}", tamanu_renderer::to_yaml(&resources)?),
		Format::Stream => print!("{}", tamanu_renderer::to_stream(&resources)?),
		Format::Json => println!("{}", serde_json::to_string_pretty(&resources)?),
	}
	Ok(())
}

fn read_stdin() -> Result<String> {
	let mut s = String::new();
	std::io::stdin().read_to_string(&mut s)?;
	Ok(s)
}
