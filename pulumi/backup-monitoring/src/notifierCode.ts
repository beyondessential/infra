// Posts ops alerts to a Slack workflow trigger. Two payload shapes arrive: raw
// EventBridge events (the central backup-failure rule targets this directly, so the
// email path keeps its own input transformer) and SNS messages carrying CloudWatch
// alarm notifications from member accounts.
export const NOTIFIER_CODE = `import json
import os
import urllib.parse
import urllib.request

import boto3

SLACK_WEBHOOK_URL = os.environ['SLACK_WEBHOOK_URL']

# Organizations is a global service reachable only via us-east-1.
organizations = boto3.client('organizations', region_name='us-east-1')

_account_names = {}


def account_name(account_id):
    if not account_id:
        return ''
    if account_id not in _account_names:
        try:
            described = organizations.describe_account(AccountId=account_id)
            _account_names[account_id] = described['Account']['Name']
        except Exception:
            # An unresolvable name must never stop an alert reaching Slack.
            return account_id
    return _account_names[account_id]


def region_from_arn(arn):
    parts = (arn or '').split(':')
    return parts[3] if len(parts) > 3 else ''


def from_backup_event(event):
    detail = event.get('detail', {})
    region = event.get('region', '')
    state = detail.get('state', 'UNKNOWN')
    resource = detail.get('resourceArn', '')
    return {
        'title': f'AWS Backup job {state}',
        'detail': ' '.join(filter(None, [detail.get('statusMessage', ''), resource])),
        'account': event.get('account', ''),
        'region': region,
        'url': f'https://console.aws.amazon.com/backup/home?region={region}#/jobs',
    }


def from_cloudwatch_alarm(message):
    region = region_from_arn(message.get('AlarmArn', ''))
    name = message.get('AlarmName', 'alarm')
    state = message.get('NewStateValue', 'UNKNOWN')
    quoted = urllib.parse.quote(name)
    return {
        'title': f'{name} is {state}',
        'detail': message.get('NewStateReason', ''),
        'account': message.get('AWSAccountId', ''),
        'region': region,
        'url': (
            f'https://console.aws.amazon.com/cloudwatch/home?region={region}'
            f'#alarmsV2:alarm/{quoted}'
        ),
    }


def payloads(event):
    # EventBridge delivers the event itself; SNS wraps messages in Records.
    if 'Records' in event:
        for record in event['Records']:
            raw = record.get('Sns', {}).get('Message', '')
            try:
                message = json.loads(raw)
            except (ValueError, TypeError):
                message = None
            if isinstance(message, dict) and 'AlarmName' in message:
                yield from_cloudwatch_alarm(message)
            elif isinstance(message, dict) and message.get('source') == 'aws.backup':
                yield from_backup_event(message)
            else:
                subject = record.get('Sns', {}).get('Subject') or 'Ops alert'
                yield {
                    'title': subject,
                    'detail': raw[:1500],
                    'account': '',
                    'region': '',
                    'url': '',
                }
    else:
        yield from_backup_event(event)


def post(payload):
    payload['accountName'] = account_name(payload.get('account'))
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


def handler(event, context):
    for payload in payloads(event):
        post(payload)
`;
