# Pulumi

## Setup

### Install

Install pulumi CLI: https://www.pulumi.com/docs/get-started/install/

- Mac: `brew install pulumi`
- Linux: `curl -fsSL https://get.pulumi.com | sh`
  - **On Arch, do not use the one from `community`, it is missing important binaries!**
- Windows: `choco install pulumi` (or as Linuxes in WSL)

### Login

Login to pulumi: `pulumi login`.

Use credential in Bitwarden (Engineering / Common infrastructure / Pulumi common account)
or your own account if you have one.

### AWS

You should use `aws-sso`.

## Usage

### Setup

0. Install NodeJS 24 or higher
1. Change into the `pulumi` directory: `cd pulumi`
2. Install dependencies: `npm install`

### Deploy

1. Change into the desired project directory: `cd stacks/tamanu/on-k8s`
2. Run your desired Pulumi command, e.g. `pulumi up`

### Stacks

Each project has a set of stacks. Stacks are a way to deploy the same project
with different configurations. For example, in `tamanu-internal` we have a
`main` stack for the environment that's spun up for latest state of the `main`
branch, and branch-specific stacks for each branch that's deployed for feature
testing or for pre-release testing.

```
$ pulumi stack ls
```

When developing changes to a Pulumi project, you should create a separate stack.
The convention is to name these `opsdev-<your-name>`. Destroy\* and delete that
stack when you're done with it.

```
$ pulumi stack init opsdev-felix
$ pulumi up

# ...

$ pulumi destroy
$ pulumi stack rm opsdev-felix
```

(\* In Pulumi, "destroy" means to remove the actual resources in the cloud, and
"delete" means to remove the stack configuration itself from the Pulumi state.)
