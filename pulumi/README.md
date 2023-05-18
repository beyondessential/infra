# Pulumi infra

## Setup

### Install

Install pulumi CLI: https://www.pulumi.com/docs/get-started/install/

- Mac: `brew install pulumi`
- Linux: `curl -fsSL https://get.pulumi.com | sh`
  - **On Arch, do not use the one from `community`, it is missing important binaries!**
- Windows: `choco install pulumi` (or as Linuxes in WSL)

### Login

Login to pulumi: `pulumi login`.

Use credential in Bitwarden (Engineering / Common infrastructure / Pulumi common account).

### AWS

You should have AWS credentials in `~/.aws/credentials` (or in `~/.aws/config`).
Make sure you have a working `default` profile.

## Usage

Each Pulumi project is its own directory below this one. Pulumi projects are
roughly mapped to different approaches and thematics around deploying an or a
set of applications. For example, `tamanu-internal` is about the test and demo
environments for Tamanu, in BES's own AWS accounts, while `tamanu-aws-prod` is a
managed production environment in country-specific AWS accounts, and
`tamanu-on-prem` is the AWS-based support infrastructure for Tamanu on premise.

### Setup

Each project is completely separate code-wise, but shares organisation and
conventions.

- change into the project directory: `cd tamanu-internal`
- install dependencies: `npm i`

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

