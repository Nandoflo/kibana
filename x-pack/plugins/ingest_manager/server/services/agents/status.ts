/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License;
 * you may not use this file except in compliance with the Elastic License.
 */

import { SavedObjectsClientContract } from 'kibana/server';
import { listAgents } from './crud';
import { AGENT_EVENT_SAVED_OBJECT_TYPE } from '../../constants';
import { AgentStatus, Agent } from '../../types';

import {
  AGENT_POLLING_THRESHOLD_MS,
  AGENT_TYPE_PERMANENT,
  AGENT_TYPE_TEMPORARY,
  AGENT_TYPE_EPHEMERAL,
} from '../../constants';

export function getAgentStatus(agent: Agent, now: number = Date.now()): AgentStatus {
  const { type, last_checkin: lastCheckIn } = agent;
  const msLastCheckIn = new Date(lastCheckIn || 0).getTime();
  const msSinceLastCheckIn = new Date().getTime() - msLastCheckIn;
  const intervalsSinceLastCheckIn = Math.floor(msSinceLastCheckIn / AGENT_POLLING_THRESHOLD_MS);
  if (!agent.active) {
    return 'inactive';
  }
  if (agent.current_error_events.length > 0) {
    return 'error';
  }
  switch (type) {
    case AGENT_TYPE_PERMANENT:
      if (intervalsSinceLastCheckIn >= 4) {
        return 'error';
      }
      if (intervalsSinceLastCheckIn >= 2) {
        return 'warning';
      }
    case AGENT_TYPE_TEMPORARY:
      if (intervalsSinceLastCheckIn >= 3) {
        return 'offline';
      }
    case AGENT_TYPE_EPHEMERAL:
      if (intervalsSinceLastCheckIn >= 3) {
        return 'inactive';
      }
  }
  return 'online';
}

export async function getAgentsStatusForPolicy(
  soClient: SavedObjectsClientContract,
  policyId: string
) {
  const [all, error, offline] = await Promise.all(
    [undefined, buildKueryForErrorAgents(), buildKueryForOfflineAgents()].map(kuery =>
      listAgents(soClient, {
        showInactive: true,
        perPage: 0,
        page: 1,
        kuery: kuery
          ? `(${kuery}) and (agents.policy_id:"${policyId}")`
          : `agents.policy_id:"${policyId}"`,
      })
    )
  );

  return {
    events: await getEventsCountForPolicyId(soClient, policyId),
    total: all.total,
    online: all.total - error.total - offline.total,
    error: error.total,
    offline: offline.total,
  };
}

async function getEventsCountForPolicyId(soClient: SavedObjectsClientContract, policyId: string) {
  const { total } = await soClient.find({
    type: AGENT_EVENT_SAVED_OBJECT_TYPE,
    filter: `agent_events.attributes.policy_id:"${policyId}"`,
    perPage: 0,
    page: 1,
    sortField: 'timestamp',
    sortOrder: 'DESC',
    defaultSearchOperator: 'AND',
  });

  return total;
}

function buildKueryForOfflineAgents(now: number = Date.now()) {
  return `agents.type:${AGENT_TYPE_TEMPORARY} AND agents.last_checkin < ${now -
    3 * AGENT_POLLING_THRESHOLD_MS}`;
}

function buildKueryForErrorAgents(now: number = Date.now()) {
  return `agents.type:${AGENT_TYPE_PERMANENT} AND agents.last_checkin < ${now -
    4 * AGENT_POLLING_THRESHOLD_MS}`;
}
