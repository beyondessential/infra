#!/usr/bin/env node

// Renames IAM backup users in AWS and updates Pulumi state to match,
// avoiding the delete-and-recreate that would void access credentials.
//
// Run from the tamanu/on-linux stack directory with the correct stack selected
// and ambient AWS credentials for the target account.
//
// Usage:
//   node /path/to/rename-pulumi-backup-users.mjs [--execute]

import { execSync, spawnSync } from 'child_process';
import { writeFileSync, readFileSync } from 'fs';
import { createInterface } from 'readline/promises';

const IAM_USER_TYPE = 'aws-native:iam:User';
const EXECUTE = process.argv.includes('--execute');

function exec(cmd, { throwOnError = true, maxBuffer = 100 * 1024 * 1024 } = {}) {
  try {
    return execSync(cmd, { encoding: 'utf-8', maxBuffer, stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (e) {
    if (throwOnError) {
      const stderr = e.stderr?.trim();
      throw new Error(`Command failed: ${cmd}\n${stderr || e.message}`);
    }
    return { stdout: e.stdout || '', stderr: e.stderr || '', status: e.status };
  }
}

function getNormalizedStack(stackName) {
  return stackName
    .toLowerCase()
    .replaceAll(/[^a-z0-9-]+/g, '-')
    .replace(/-+$/, '')
    .slice(0, 63)
    .replaceAll(/^-+|-+$/g, '');
}

function extractLogicalName(urn) {
  return urn.split('::').pop();
}

function extractTypeFromUrn(urn) {
  // URN format: urn:pulumi:STACK::PROJECT::PARENT_TYPE$RESOURCE_TYPE::NAME
  // The type segment may contain a $ for nested resources; we want the last type.
  const typeSegment = urn.split('::').at(-2);
  const lastType = typeSegment.split('$').pop();
  return lastType;
}

function extractInstanceId(logicalName, prefix) {
  if (prefix && logicalName.startsWith(prefix)) {
    return logicalName.slice(prefix.length);
  }
  return null;
}

function getUserName(resource) {
  return (
    resource?.outputs?.userName ??
    resource?.outputs?.UserName ??
    resource?.inputs?.userName ??
    resource?.inputs?.UserName ??
    null
  );
}

function getStepUserName(step) {
  // Preview JSON uses newState/oldState, not new/old
  for (const key of ['newState', 'oldState', 'new', 'old']) {
    const obj = step[key];
    if (!obj) continue;
    const name =
      obj.inputs?.userName ??
      obj.inputs?.UserName ??
      obj.outputs?.userName ??
      obj.outputs?.UserName;
    if (name) return name;
  }
  return null;
}

function parsePreviewJson(raw) {
  // pulumi preview --json outputs a single JSON object to stdout
  try {
    return JSON.parse(raw);
  } catch {
    // Fall back: try to find the last complete JSON object in output
    const match = raw.match(/\{[\s\S]*\}\s*$/);
    if (match) {
      return JSON.parse(match[0]);
    }
    throw new Error('Could not parse preview JSON output');
  }
}

async function confirm(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(question);
    return answer.trim().toLowerCase() === 'yes';
  } finally {
    rl.close();
  }
}

async function main() {
  // -- Validate environment --
  try {
    readFileSync('Pulumi.yaml', 'utf-8');
  } catch {
    console.error(
      'Pulumi.yaml not found. Run this script from the tamanu/on-linux stack directory.',
    );
    process.exit(1);
  }

  const stackName = exec('pulumi stack --show-name').trim();
  const normalizedStack = getNormalizedStack(stackName);
  const newPrefix = `backups-kopia-${normalizedStack}-`;

  console.log(`Stack: ${stackName}`);
  console.log(`Normalized stack: ${normalizedStack}`);
  console.log(`Expected logical name prefix: ${newPrefix}`);
  if (!EXECUTE) console.log('(dry run — pass --execute to apply changes)\n');

  // -- Export current state --
  console.log('\nExporting Pulumi state...');
  const stateRaw = exec('pulumi stack export');
  const originalState = JSON.parse(stateRaw);

  // Deep copy so we can mutate without affecting the backup
  const state = JSON.parse(stateRaw);
  const resources = state.deployment.resources;

  const existingUsers = resources.filter(
    (r) => r.type === IAM_USER_TYPE && r.urn.includes('kopia'),
  );
  console.log(`Found ${existingUsers.length} backup IAM user(s) in state.`);

  // Check if any actually need renaming
  const alreadyCorrect = existingUsers.filter((r) => {
    const name = extractLogicalName(r.urn);
    return name.startsWith(newPrefix);
  });
  const needsRename = existingUsers.filter((r) => {
    const name = extractLogicalName(r.urn);
    return !name.startsWith(newPrefix);
  });

  if (needsRename.length === 0) {
    console.log('All backup user URNs already match the expected naming. Nothing to do.');
    return;
  }

  console.log(
    `${needsRename.length} user(s) need renaming, ${alreadyCorrect.length} already correct.`,
  );

  // -- Run preview to discover new names --
  console.log('\nRunning pulumi preview --json (this may take a while)...');
  const previewResult = spawnSync('pulumi', ['preview', '--json'], {
    encoding: 'utf-8',
    maxBuffer: 100 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  if (!previewResult.stdout) {
    console.error('Preview produced no output.');
    if (previewResult.stderr) console.error(previewResult.stderr);
    process.exit(1);
  }

  const preview = parsePreviewJson(previewResult.stdout);
  const steps = preview.steps || [];

  // Type is not a top-level field on steps; extract from the URN instead
  const iamSteps = steps.filter((s) => extractTypeFromUrn(s.urn) === IAM_USER_TYPE);
  const creates = iamSteps.filter((s) => s.op === 'create' || s.op === 'create-replacement');
  const deletes = iamSteps.filter((s) => s.op === 'delete' || s.op === 'delete-replaced');

  if (creates.length === 0 && deletes.length === 0) {
    console.log('Preview shows no IAM User creates or deletes. Nothing to do.');
    return;
  }

  console.log(`Preview: ${creates.length} create(s), ${deletes.length} delete(s) for IAM users.`);

  // -- Build instance id → create mapping --
  const createsByInstanceId = new Map();
  for (const step of creates) {
    const logicalName = extractLogicalName(step.urn);
    const instanceId = extractInstanceId(logicalName, newPrefix);
    if (!instanceId) {
      console.warn(`  Skipping unexpected create: ${logicalName}`);
      continue;
    }
    createsByInstanceId.set(instanceId, step);
  }

  // Sort instance IDs longest-first so e.g. "facility-readonly" matches before "readonly"
  const sortedInstanceIds = [...createsByInstanceId.keys()].sort((a, b) => b.length - a.length);

  // -- Match deletes to creates --
  const plan = [];
  const matchedDeletes = new Set();

  for (const instanceId of sortedInstanceIds) {
    const createStep = createsByInstanceId.get(instanceId);

    // Find a delete whose logical name ends with this instance id
    const matchingDelete = deletes.find((d) => {
      if (matchedDeletes.has(d.urn)) return false;
      const name = extractLogicalName(d.urn);
      return name.endsWith(`-${instanceId}`) || name === instanceId;
    });

    if (!matchingDelete) {
      console.warn(`  No matching old user for instance "${instanceId}" — will be created fresh.`);
      continue;
    }
    matchedDeletes.add(matchingDelete.urn);

    // Extract old userName from state (most reliable)
    const stateResource = resources.find((r) => r.urn === matchingDelete.urn);
    const oldUserName = getUserName(stateResource) || stateResource?.id;

    // Extract new userName from preview create step
    const newUserName = getStepUserName(createStep);

    if (!oldUserName) {
      console.warn(`  Cannot determine old username for ${matchingDelete.urn}, skipping.`);
      continue;
    }
    if (!newUserName) {
      console.warn(`  Cannot determine new username for instance "${instanceId}" from preview.`);
      console.warn(`  Preview create step keys: ${JSON.stringify(Object.keys(createStep))}`);
      for (const key of ['newState', 'oldState', 'new', 'old']) {
        if (createStep[key]) {
          console.warn(`  "${key}" keys: ${JSON.stringify(Object.keys(createStep[key]))}`);
        }
      }
      continue;
    }

    // Extract managed policy ARNs from state so we can re-attach after rename
    const managedPolicyArns =
      stateResource?.inputs?.managedPolicyArns || stateResource?.outputs?.managedPolicyArns || [];

    plan.push({
      instanceId,
      oldUrn: matchingDelete.urn,
      newUrn: createStep.urn,
      oldUserName,
      newUserName,
      managedPolicyArns,
    });
  }

  // Report unmatched deletes
  for (const d of deletes) {
    if (!matchedDeletes.has(d.urn)) {
      console.warn(`  Unmatched delete (being removed entirely): ${extractLogicalName(d.urn)}`);
    }
  }

  if (plan.length === 0) {
    console.log('\nNo renameable user pairs found. Nothing to do.');
    return;
  }

  // -- Display plan --
  console.log(`\nRename plan (${plan.length} user(s)):\n`);
  const colOld = Math.max(...plan.map((p) => p.oldUserName.length));
  for (const p of plan) {
    console.log(`  ${p.oldUserName.padEnd(colOld)}  →  ${p.newUserName}`);
  }

  if (!EXECUTE) {
    console.log('\nDry run complete. Pass --execute to apply changes.');
    return;
  }

  // -- Confirm --
  console.log('');
  const ok = await confirm('Proceed with renames? (yes/no) ');
  if (!ok) {
    console.log('Aborted.');
    return;
  }

  // -- Save backup --
  const backupPath = `state-backup-${stackName}-${Date.now()}.json`;
  writeFileSync(backupPath, JSON.stringify(originalState, null, 2));
  console.log(`\nState backup saved to ${backupPath}`);

  // -- Rename in AWS --
  const awsRenamed = [];
  for (const p of plan) {
    if (p.oldUserName === p.newUserName) {
      console.log(`  ${p.oldUserName}: name unchanged, skipping AWS rename.`);
      awsRenamed.push(p);
      continue;
    }

    console.log(`  Renaming in AWS: ${p.oldUserName} → ${p.newUserName}`);
    try {
      exec(`aws iam update-user --user-name '${p.oldUserName}' --new-user-name '${p.newUserName}'`);

      // Re-attach managed policies (update-user can detach them in some circumstances)
      for (const policyArn of p.managedPolicyArns) {
        console.log(`    Re-attaching policy: ${policyArn}`);
        exec(
          `aws iam attach-user-policy --user-name '${p.newUserName}' --policy-arn '${policyArn}'`,
        );
      }

      awsRenamed.push(p);
    } catch (e) {
      console.error(`  FAILED to rename ${p.oldUserName}: ${e.message}`);
      console.error('  Stopping to avoid partial state. Fix the above and re-run.');
      if (awsRenamed.length > 0) {
        console.error(
          `\n  ${awsRenamed.length} user(s) were already renamed in AWS but state has NOT been updated.`,
        );
        console.error('  You may need to manually reconcile or restore from the backup.');
      }
      process.exit(1);
    }
  }

  // -- Update Pulumi state --
  console.log('\nUpdating Pulumi state...');

  const urnMap = new Map(plan.map((p) => [p.oldUrn, p.newUrn]));

  for (const p of plan) {
    const resource = resources.find((r) => r.urn === p.oldUrn);
    if (!resource) {
      console.error(`  Resource not found in state for URN: ${p.oldUrn}`);
      continue;
    }

    resource.urn = p.newUrn;

    // Update the resource ID (primary identifier)
    if (typeof resource.id === 'string') {
      if (resource.id === p.oldUserName) {
        resource.id = p.newUserName;
      } else {
        // Might be JSON-encoded
        try {
          const parsed = JSON.parse(resource.id);
          if (parsed.UserName === p.oldUserName) {
            parsed.UserName = p.newUserName;
            resource.id = JSON.stringify(parsed);
          }
        } catch {
          // Not JSON, try replacing as substring
          resource.id = resource.id.replace(p.oldUserName, p.newUserName);
        }
      }
    }

    // Update inputs and outputs
    for (const section of ['inputs', 'outputs']) {
      if (!resource[section]) continue;
      for (const key of ['userName', 'UserName']) {
        if (resource[section][key] === p.oldUserName) {
          resource[section][key] = p.newUserName;
        }
      }
    }

    console.log(`  Updated: ${p.instanceId}`);
  }

  // Update all cross-references (parent, dependencies, propertyDependencies)
  for (const r of resources) {
    if (urnMap.has(r.parent)) {
      r.parent = urnMap.get(r.parent);
    }

    if (Array.isArray(r.dependencies)) {
      r.dependencies = r.dependencies.map((d) => urnMap.get(d) ?? d);
    }

    if (r.propertyDependencies && typeof r.propertyDependencies === 'object') {
      for (const key of Object.keys(r.propertyDependencies)) {
        if (Array.isArray(r.propertyDependencies[key])) {
          r.propertyDependencies[key] = r.propertyDependencies[key].map((d) => urnMap.get(d) ?? d);
        }
      }
    }
  }

  // -- Import modified state --
  const modifiedPath = `state-modified-${stackName}-${Date.now()}.json`;
  writeFileSync(modifiedPath, JSON.stringify(state, null, 2));
  console.log(`Modified state written to ${modifiedPath}`);

  console.log('Importing state...');
  exec(`pulumi stack import --file '${modifiedPath}'`);
  console.log('State imported.');

  console.log('\nDone. Now run `pulumi up` to have Pulumi reseal the state correctly.');
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
