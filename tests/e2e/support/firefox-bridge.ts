/** Test-copy-only DOM controls. No eval, mock APIs or production behavior changes.
 * Firefox BiDi does not expose extension realms, so commands run in the real
 * options page; all application runtime messages still reach the real background. */
export function firefoxBridge(url: string, token: string) {
  return `
(async () => {
  const endpoint = ${JSON.stringify(url)};
  const token = ${JSON.stringify(token)};
  while (true) {
    try {
      const command = await (await fetch(endpoint + '/bridge/' + token)).json();
      if (!command) { await new Promise(resolve => setTimeout(resolve, 50)); continue; }
      const {id, operation, args} = command;
      let value = null; let error;
      try {
        if (operation === 'ready') value = !!document.querySelector('button[type="submit"]') && !document.querySelector('button[type="submit"]').disabled;
        else if (operation === 'active') value = (await browser.tabs.query({active:true,currentWindow:true})).some(tab => tab.url === location.href);
        else if (operation === 'status') value = document.querySelector('[role="status"]').textContent;
        else if (operation === 'model-status') value = document.querySelector('[data-testid="model-status"]').textContent;
        else if (operation === 'document-generation') value = performance.timeOrigin;
        else if (operation === 'dictionary-text') value = document.querySelector('[data-testid="dictionary-' + args[0] + '"]').textContent;
        else if (operation === 'dictionary-files') {
          const transfer = new DataTransfer();
          for (const file of args[0]) transfer.items.add(new File([Uint8Array.from(atob(file.base64), char => char.charCodeAt(0))], file.name));
          const input = document.querySelector('[name="dictionaryFiles"]'); input.files = transfer.files;
          input.dispatchEvent(new Event('change', {bubbles:true}));
        } else if (operation === 'dictionary-benchmark') {
          value = [];
          for (const word of args[0]) {
            const start = performance.now(); const response = await browser.runtime.sendMessage({type:'lexicon:lookup',id:crypto.randomUUID(),word});
            if (!response.ok) throw new Error(response.error);
            value.push({word,ms:performance.now()-start,hits:response.data.length});
          }
        } else if (operation === 'reload') { setTimeout(() => location.reload(), 200); }
        else if (operation === 'fill') {
          const input = document.querySelector('[name="' + args[0] + '"]');
          input.value = args[1]; input.dispatchEvent(new Event('input', {bubbles:true}));
        } else if (operation === 'select') {
          const input = document.querySelector('[name="' + args[0] + '"]');
          input.value = args[1]; input.dispatchEvent(new Event('change', {bubbles:true}));
        } else if (operation === 'click') {
          const button = [...document.querySelectorAll('button')].find(item => (item.getAttribute('aria-label') ?? item.textContent.trim()) === args[0]);
          if (!button || button.disabled) throw new Error('Button unavailable: ' + args[0]);
          button.click();
        } else if (operation === 'toggle') {
          const tab = (await browser.tabs.query({})).find(tab => tab.url?.startsWith(args[0]));
          value = await browser.tabs.sendMessage(tab.id, {type:'page:toggle'});
        } else if (operation === 'reading-tab') {
          const tab = (await browser.tabs.query({})).find(tab => tab.url?.startsWith(args[0]));
          if (!tab?.id || tab.windowId === undefined) throw new Error('Reading tab unavailable');
          if (args[1]) await browser.tabs.update(tab.id, {active:true});
          else await browser.tabs.create({windowId:tab.windowId,url:'about:blank',active:true});
        } else if (operation === 'reinject') {
          const tab = (await browser.tabs.query({})).find(tab => tab.url?.startsWith(args[0]));
          await browser.tabs.executeScript(tab.id, {file:'content-scripts/content.js'});
        } else throw new Error('Unknown test operation');
      } catch (reason) { error = reason.message; }
      await fetch(endpoint + '/reply/' + token, {method:'POST', body:JSON.stringify({id,value,error})});
    } catch { break; }
  }
})();`;
}
