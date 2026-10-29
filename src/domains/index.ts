import type { DomainName, DomainHandler } from '../utils/types.js';

const domainCache = new Map<DomainName, DomainHandler>();

export async function getDomainHandler(domain: DomainName): Promise<DomainHandler> {
  const cached = domainCache.get(domain);
  if (cached) return cached;

  let handler: DomainHandler;
  switch (domain) {
    case 'system': {
      const { systemHandler } = await import('./system.js');
      handler = systemHandler;
      break;
    }
    case 'agents': {
      const { agentsHandler } = await import('./agents.js');
      handler = agentsHandler;
      break;
    }
    case 'alerts': {
      const { alertsHandler } = await import('./alerts.js');
      handler = alertsHandler;
      break;
    }
    case 'targets': {
      const { targetsHandler } = await import('./targets.js');
      handler = targetsHandler;
      break;
    }
    case 'organizations': {
      const { organizationsHandler } = await import('./organizations.js');
      handler = organizationsHandler;
      break;
    }
    case 'scans': {
      const { scansHandler } = await import('./scans.js');
      handler = scansHandler;
      break;
    }
    case 'rules': {
      const { rulesHandler } = await import('./rules.js');
      handler = rulesHandler;
      break;
    }
    default:
      throw new Error(`Unknown domain: ${domain}`);
  }

  domainCache.set(domain, handler);
  return handler;
}
