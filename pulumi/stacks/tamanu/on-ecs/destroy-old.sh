#!/usr/bin/fish

pulumi stack select
pulumi stack export > state.json
sed -i s/100.74.88.92/100.72.193.51/ state.json
read
pulumi stack import -f < state.json
rm state.json

pulumi config refresh
rm *.bak

aws-sso exec --arn=arn:aws:iam::143295493206:role/AdminAccess  pulumi destroy --remove -f
