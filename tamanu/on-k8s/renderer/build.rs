// The templates are compiled into the binary, and the macro that embeds them
// does not tell Cargo to watch them on stable.
fn main() {
	println!("cargo:rerun-if-changed=templates");
}
