import { ENTITY_TYPES } from '../../src/shared/message-types';
import { OVERLAY_ENTITY_TYPES } from '../../src/ui/overlay/overlay';

describe('ReviewOverlay entity taxonomy', () => {
  test('uses the shared entity list for detected retyping and manual marking controls', () => {
    expect(OVERLAY_ENTITY_TYPES).toBe(ENTITY_TYPES);
    expect(OVERLAY_ENTITY_TYPES).toEqual(
      expect.arrayContaining(['ADDRESS', 'URL', 'USERNAME', 'PASSWORD', 'BANK_ACCOUNT'])
    );
  });
});
