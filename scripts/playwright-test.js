const { chromium } = require('playwright');
const path = require('path');

const extensionPath = path.join(__dirname, '..', 'dist');

async function testSite(site) {
  console.log(`\nTesting ${site.name} at ${site.url}...`);
  
  const context = await chromium.launchPersistentContext('', {
    headless: false,
    channel: 'msedge',
    permissions: ['clipboard-read', 'clipboard-write'],
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`
    ],
  });

  const page = await context.newPage();
  page.on('console', msg => console.log(`[Browser Console] ${msg.type()}: ${msg.text()}`));
  page.on('pageerror', exception => console.log(`[Browser Console] Uncaught exception: ${exception}`));
  
  try {
    await page.goto(site.url, { waitUntil: 'domcontentloaded' });
    const currentUrl = page.url();
    console.log(`Landed on URL: ${currentUrl}`);
    await page.waitForTimeout(2000); // Give it time to render
    await page.screenshot({ path: `screenshot-${site.name}.png` });
  } catch (err) {
    console.error(`Failed to navigate to ${site.url}:`, err);
    await context.close();
    return false;
  }
  
  try {
    // Wait a bit for the extension to inject its content scripts
    await page.waitForTimeout(2000);

    // Look for the input element
    let inputElement = null;
    let targetFrame = null;
    
    for (const selector of site.inputSelectors) {
      const frames = [...page.frames()].reverse();
      // Move main frame to the end
      const mainFrame = page.mainFrame();
      const sortedFrames = frames.filter(f => f !== mainFrame);
      sortedFrames.push(mainFrame);
      
      for (const frame of sortedFrames) {
        try {
          inputElement = await frame.waitForSelector(selector, { state: 'visible', timeout: 2000 });
          if (inputElement) {
            targetFrame = frame;
            console.log(`✅ Input element found in frame ${frame.url()} using selector: ${selector}`);
            break;
          }
        } catch (e) {
          // ignore timeout
        }
      }
      if (inputElement) break;
    }
    
    if (!inputElement) {
      console.error(`❌ Input element not found using any provided selector.`);
      
      const allTextareas = await page.$$eval('textarea', els => els.length);
      const allContentEditables = await page.$$eval('[contenteditable="true"]', els => els.length);
      console.log(`Available textareas: ${allTextareas}, contenteditables: ${allContentEditables}`);
      
      await context.close();
      return;
    }

    // Focus and paste sensible data
    await inputElement.focus();
    
    const sensitiveText = "Mein Name ist Max Mustermann und meine Telefonnummer ist 0151-1234567.";
    
    // Dispatch paste event on the discovered inputElement
    await inputElement.evaluate((element, text) => {
      // Find the deepest focusable/active part of this element if it has a shadow root
      let target = element;
      while (target.shadowRoot && target.shadowRoot.activeElement) {
         target = target.shadowRoot.activeElement;
      }
      
      const dataTransfer = new DataTransfer();
      dataTransfer.setData('text/plain', text);
      const pasteEvent = new ClipboardEvent('paste', {
        clipboardData: dataTransfer,
        bubbles: true,
        cancelable: true,
        composed: true
      });
      target.dispatchEvent(pasteEvent);
    }, sensitiveText);

    // Wait and check if the Privacy Guardrail dialog or overlay appears
    await page.waitForTimeout(3000); // Wait for NER model processing
    
    // Privacy Guardrail typically creates a shadow DOM container for its UI
    // In this extension it's usually `pg-review-overlay` or similar custom element.
    // Let's check for it in the DOM.
    let hasGuardrail = false;
    for (const frame of page.frames()) {
      try {
        const found = await frame.evaluate(() => {
          const allElements = Array.from(document.querySelectorAll('*'));
          return allElements.some(el => 
            (el.tagName && el.tagName.toLowerCase().startsWith('pg-')) || 
            (el.id && el.id.toLowerCase().startsWith('pg-'))
          );
        });
        if (found) {
          hasGuardrail = true;
          break;
        }
      } catch (e) {
        // ignore
      }
    }

    if (hasGuardrail) {
      console.log(`✅ SUCCESS: Privacy Guardrail intercepted the paste on ${site.name}.`);
    } else {
      console.log(`❌ FAILURE: Privacy Guardrail did NOT intercept the paste on ${site.name}.`);
    }
    
  } catch (err) {
    console.error(`Error testing ${site.name}:`, err);
  } finally {
    await context.close();
  }
}

async function runAllTests() {
  const sites = [
    {
      name: 'ChatGPT',
      url: 'https://chatgpt.com/',
      inputSelectors: ['#prompt-textarea', 'textarea']
    },
    {
      name: 'Claude',
      url: 'https://claude.ai/',
      inputSelectors: ['div[contenteditable="true"]', 'textarea']
    },
    {
      name: 'Gemini',
      url: 'https://gemini.google.com/',
      inputSelectors: ['rich-textarea', 'div[contenteditable="true"]']
    },
    {
      name: 'Copilot',
      url: 'https://copilot.microsoft.com/',
      inputSelectors: ['#userInput', 'div[contenteditable="true"]', 'textarea']
    },
    {
      name: 'DeepL',
      url: 'https://www.deepl.com/translator',
      inputSelectors: [
        'd-textarea[aria-labelledby="translation-source-heading"]',
        'div[contenteditable="true"]',
        'textarea'
      ]
    },
    {
      name: 'HuggingChat',
      url: 'https://huggingface.co/chat/',
      inputSelectors: ['textarea']
    }
  ];

  for (const site of sites) {
    let retries = 2;
    while (retries > 0) {
      try {
        await testSite(site);
        break; // success, break out of retry loop
      } catch (e) {
        console.error(`Retry failed for ${site.name}:`, e);
        retries--;
      }
    }
  }
}

runAllTests().catch(console.error);
