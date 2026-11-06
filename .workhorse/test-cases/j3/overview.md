# Emergency SSH key removal and Session Manager access

## Baseline

- [x] A run removes the emergency key from the `ubuntu` user's authorized keys and keeps every other line (verifies spec: LNXSRV).
- [x] A run removes the key whatever comment or options its line carries.
- [x] A file without the key is left unchanged.
- [x] A missing authorized keys file is not an error.
- [ ] A host with no `ubuntu` user skips the removal.
- [ ] On an EC2 instance the SSM Agent is installed, enabled and running after a run; on a non-EC2 server the task does nothing (verifies spec: LNXSRV).
- [ ] A check-mode run on an instance without the agent does not fail.

## Provisioning

- [ ] A preview of an existing deployment shows each instance updated in place for the instance profile and not replaced (verifies spec: LNXAWS).
- [ ] A new instance's user data installs the SSM Agent before joining the tailnet and contains no SSH public key (verifies spec: LNXAWS).
- [ ] A new instance appears as online in Systems Manager, and a Session Manager session opens while the instance is off the tailnet and its security group has no SSH rule (verifies spec: LNXAWS).
- [ ] A rule added to the security group by hand survives a later run (verifies spec: LNXAWS).
