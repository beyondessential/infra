import { dagsterVersion } from './config.ts';

export function appSelector(component: string): { [key: string]: string } {
  return {
    'app.kubernetes.io/name': 'dagster',
    'app.kubernetes.io/component': component,
  };
}

export function appLabels(component: string): { [key: string]: string } {
  return {
    ...appSelector(component),
    'app.kubernetes.io/version': dagsterVersion,
  };
}
