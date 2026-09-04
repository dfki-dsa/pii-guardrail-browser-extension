/** @jest-environment jsdom */

import { ChatGptAdapter } from '../../../src/content/site-adapters/chatgpt-adapter';
import { ClaudeAdapter } from '../../../src/content/site-adapters/claude-adapter';
import { GeminiAdapter } from '../../../src/content/site-adapters/gemini-adapter';

/**
 * `hasConversationId` decides whether a URL identifies a persisted
 * conversation or the site's "new chat" screen. The content script uses the
 * false -> true transition to detect that the site has just created the
 * conversation, so pending placeholder mappings can be moved onto the URL the
 * user will return to.
 */
describe.each([
  [
    'Claude',
    new ClaudeAdapter(),
    ['https://claude.ai/chat/9f1c-2b', 'https://claude.ai/chat/9f1c-2b?x=1'],
    ['https://claude.ai/new', 'https://claude.ai/', 'https://claude.ai/chats'],
  ],
  [
    'ChatGPT',
    new ChatGptAdapter(),
    [
      'https://chatgpt.com/c/9f1c-2b',
      'https://chatgpt.com/g/g-abc/c/9f1c-2b',
      // The web-mobile build routes conversations under `/uc/`. Missing this
      // stranded every mapping under the shared "new chat" key and made the
      // content script wipe the live map when the chat got its own URL.
      'https://chatgpt.com/uc/9f1c-2b',
      'https://chatgpt.com/g/g-abc/uc/9f1c-2b',
      'https://chatgpt.com/uc/9f1c-2b?model=auto',
    ],
    [
      'https://chatgpt.com/',
      'https://chatgpt.com/g/g-abc',
      // A trailing `c`, and segments that merely contain one, are not routes.
      'https://chatgpt.com/uc/',
      'https://chatgpt.com/codex/tasks',
      'https://chatgpt.com/settings/account',
    ],
  ],
  [
    'Gemini',
    new GeminiAdapter(),
    ['https://gemini.google.com/app/77aa11', 'https://gemini.google.com/app/77aa11?hl=de'],
    ['https://gemini.google.com/app', 'https://gemini.google.com/'],
  ],
])('%s hasConversationId', (_name, adapter, conversationUrls, newChatUrls) => {
  it.each(conversationUrls)('recognises %s as a conversation', (url) => {
    expect(adapter.hasConversationId?.(url)).toBe(true);
  });

  it.each(newChatUrls)('recognises %s as a new-chat screen', (url) => {
    expect(adapter.hasConversationId?.(url)).toBe(false);
  });
});
