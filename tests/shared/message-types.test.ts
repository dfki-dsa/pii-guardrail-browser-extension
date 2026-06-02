import {
  ENTITY_TYPES,
  type CollectSystemSignalsRequest,
  type DismissCriticalLocalAiModalRequest,
  type EntityType,
  type GetSystemCompatibilityStatusRequest,
  type SetLocalAiDetectionRequest,
  type SupportedPageActivityRequest,
  type SystemCompatibilityStatusResponse,
  type WarmUpLocalAiRequest,
} from '../../src/shared/message-types';

describe('EntityType contract', () => {
  test('contains existing and new taxonomy values in review order', () => {
    const expected: EntityType[] = [
      'PERSON',
      'EMAIL',
      'PHONE',
      'CREDIT_CARD',
      'SSN',
      'IBAN',
      'IP_ADDRESS',
      'LOCATION',
      'ORGANIZATION',
      'ADDRESS',
      'URL',
      'USERNAME',
      'PASSWORD',
      'BANK_ACCOUNT',
      'DATE',
      'MISC',
    ];

    expect(ENTITY_TYPES).toEqual(expected);
  });

  test('contains system compatibility message contracts', () => {
    const request: GetSystemCompatibilityStatusRequest = { type: 'GET_SYSTEM_COMPATIBILITY_STATUS' };
    const collect: CollectSystemSignalsRequest = { type: 'COLLECT_SYSTEM_SIGNALS' };
    const setLocalAi: SetLocalAiDetectionRequest = { type: 'SET_LOCAL_AI_DETECTION', payload: { enabled: true } };
    const warmUp: WarmUpLocalAiRequest = { type: 'WARM_UP_LOCAL_AI', payload: { config: { ner_provider: 'transformers' } } };
    const activity: SupportedPageActivityRequest = { type: 'SUPPORTED_PAGE_ACTIVITY', payload: { visible: true } };
    const dismissModal: DismissCriticalLocalAiModalRequest = { type: 'DISMISS_CRITICAL_LOCAL_AI_MODAL' };
    const response: SystemCompatibilityStatusResponse = {
      type: 'SYSTEM_COMPATIBILITY_STATUS',
      payload: {
        schemaVersion: 1,
        policyVersion: 1,
        checkedAt: 1,
        browserMemoryGb: 8,
        webGpu: 'unknown',
        tier: 'critical',
        recommendation: 'auto-disable-local-ai',
        notes: ['Browser-reported memory is low.'],
        localAiState: 'enabled',
        runtimeState: 'not-loaded',
        criticalModal: 'pending',
      },
    };

    expect(request.type).toBe('GET_SYSTEM_COMPATIBILITY_STATUS');
    expect(collect.type).toBe('COLLECT_SYSTEM_SIGNALS');
    expect(setLocalAi.payload.enabled).toBe(true);
    expect(warmUp.payload?.config?.ner_provider).toBe('transformers');
    expect(activity.payload.visible).toBe(true);
    expect(dismissModal.type).toBe('DISMISS_CRITICAL_LOCAL_AI_MODAL');
    expect(response.payload.tier).toBe('critical');
  });
});
