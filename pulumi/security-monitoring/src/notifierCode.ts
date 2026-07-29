// Posts GuardDuty findings to a Slack workflow trigger, resolving the originating
// account ID to its organisation account name. The name is not present in the finding
// payload and EventBridge input transformers cannot look it up, which is the only
// reason this runs code rather than posting to the trigger directly.
export const NOTIFIER_CODE = `import json
import os
import urllib.request

import boto3

SLACK_WEBHOOK_URL = os.environ['SLACK_WEBHOOK_URL']

# Organizations is a global service reachable only via us-east-1.
organizations = boto3.client('organizations', region_name='us-east-1')

_account_names = {}


def account_name(account_id):
    if account_id not in _account_names:
        try:
            described = organizations.describe_account(AccountId=account_id)
            _account_names[account_id] = described['Account']['Name']
        except Exception:
            # An unresolvable name must never stop a finding reaching Slack.
            return account_id
    return _account_names[account_id]


def handler(event, context):
    detail = event['detail']
    account_id = detail['accountId']
    region = event['region']
    finding_id = detail['id']

    payload = {
        # GuardDuty emits severity as a float; 8.0 reads better as 8, 7.5 stays 7.5.
        'severity': '{:g}'.format(detail['severity']),
        'findingType': detail['type'],
        'account': account_id,
        'accountName': account_name(account_id),
        'region': region,
        'description': detail['description'],
        'url': (
            'https://console.aws.amazon.com/guardduty/home'
            f'?region={region}#/findings?search=id%3D{finding_id}'
        ),
    }

    request = urllib.request.Request(
        SLACK_WEBHOOK_URL,
        data=json.dumps(payload).encode(),
        headers={'Content-Type': 'application/json'},
        method='POST',
    )
    # Failures raise, so the invocation is retried and then dead-lettered.
    with urllib.request.urlopen(request, timeout=10) as response:
        status = response.status
        body = response.read(2000).decode('utf-8', 'replace')

    # Slack answers 200 with {"ok": false, "error": ...} when it rejects a trigger
    # payload, so the HTTP status alone does not mean the message was posted. Logged
    # either way: without this the only symptom is silence.
    print(f'slack responded {status}: {body}')
    try:
        result = json.loads(body)
    except ValueError:
        result = None
    if isinstance(result, dict) and not result.get('ok', True):
        raise RuntimeError(f'Slack rejected the payload: {body}')
`;
