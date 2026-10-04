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
        else if (operation === 'status') value = document.querySelector('[role="status"]').textContent;
        else if (operation === 'fill') {
          const input = document.querySelector('[name="' + args[0] + '"]');
          input.value = args[1]; input.dispatchEvent(new Event('input', {bubbles:true}));
        } else if (operation === 'click') {
          const button = [...document.querySelectorAll('button')].find(item => item.textContent === args[0]);
          if (!button || button.disabled) throw new Error('Button unavailable: ' + args[0]);
          button.click();
        } else if (operation === 'toggle') {
          const tab = (await browser.tabs.query({})).find(tab => tab.url?.startsWith(args[0]));
          value = await browser.tabs.sendMessage(tab.id, {type:'page:toggle'});
        } else throw new Error('Unknown test operation');
      } catch (reason) { error = reason.message; }
      await fetch(endpoint + '/reply/' + token, {method:'POST', body:JSON.stringify({id,value,error})});
    } catch { break; }
  }
})();`;
}
