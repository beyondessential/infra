import * as k8s from '@pulumi/kubernetes';
import { namespace } from './namespace.ts';
import { name } from './config.ts';

// Service name the Helm chart derives: "<release-name>-" + dagsterWebserver's
// nameOverride (default "dagster-webserver"). The Release in helm.ts has no
// explicit `name` override, so its Helm release name is the Pulumi resource
// name, "dagster" — giving "dagster-dagster-webserver". Confirmed against the
// chart's own helpers/_helpers.tpl and helpers/_service-webserver.tpl at the
// pinned version; re-check if dagsterChartVersion (config.ts) ever moves to a
// major that renames this.
const webserverServiceName = 'dagster-dagster-webserver';

// Same pattern as first-officer's own tailscale Ingress — internal-only UI,
// no oauth2-proxy, no public DNS (this cluster has neither). Access is
// decided entirely by the tailnet grant on this tag; see the plan's open
// "Tailnet ACL repo" item.
const tailscaleName = name; // e.g. "dagster-dev", "dagster-prod"

new k8s.networking.v1.Ingress('tailscale', {
	metadata: {
		namespace,
		annotations: {
			'tailscale.com/hostname': tailscaleName,
			'tailscale.com/tags': 'tag:dagster',
		},
	},
	spec: {
		ingressClassName: 'tailscale',
		tls: [{ hosts: [tailscaleName] }],
		rules: [
			{
				host: tailscaleName,
				http: {
					paths: [
						{
							path: '/',
							pathType: 'Prefix',
							backend: {
								service: {
									name: webserverServiceName,
									port: { name: 'http' },
								},
							},
						},
					],
				},
			},
		],
	},
});
