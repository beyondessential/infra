#!/usr/bin/fish

if not tailscale status >/dev/null
  # no tailscale, just display normally
  exec w
end

for line in (w)
  if not string match -qr '100[.]' $line
    echo $line
    continue
  end

  set tsip (string match -rg '\s(100[.]\\S+)' $line)
  set tsname (tailscale whois --json $tsip | jq 'if .UserProfile.LoginName == "tagged-devices" then .Node.ComputedName else .UserProfile.LoginName end')
  string replace $tsip "$tsip ($tsname)" $line
end
