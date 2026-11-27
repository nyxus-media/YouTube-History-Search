import sys, pathlib, json, subprocess, socket, time, threading, http.server, zipfile, tempfile, os
BASE = pathlib.Path(tempfile.mkdtemp(prefix='yths-firefox-test-'))
from marionette_driver.marionette import Marionette
from marionette_driver.addons import Addons

code = r'''
const unsafeWindow = window.wrappedJSObject;
const results = [];
function log(s) { results.push(s); document.body.textContent = JSON.stringify(results); }
(async () => {
const cases = {
  original: () => async () => { await new Promise(r=>setTimeout(r,50)); },
  windowPromise: () => () => new window.Promise(r => setTimeout(r,50)),
  unsafePromise: () => () => new unsafeWindow.Promise(r => setTimeout(r,50)),
  clonedThenable: () => () => cloneInto({then(r) {setTimeout(r,50);}},unsafeWindow,{cloneFunctions:true}),
  exportedCallback: () => exportFunction(() => new unsafeWindow.Promise(r=>setTimeout(r,50)),unsafeWindow),
  unwrappedClone: () => () => cloneInto({then(r) {setTimeout(r,50);}},unsafeWindow,{cloneFunctions:true}).wrappedJSObject,
  unwrappedPromise: () => () => new unsafeWindow.Promise(r=>setTimeout(r,50)).wrappedJSObject,
  unwrappedExport: () => exportFunction(() => new unsafeWindow.Promise(r=>setTimeout(r,50)),unsafeWindow).wrappedJSObject,
  pageFactory: () => unsafeWindow.Function('return function(){return new Promise(resolve=>setTimeout(resolve,50))}')(),
  pageFactorySignal: () => unsafeWindow.Function('signal','return function(){return new Promise(resolve=>signal(resolve))}')(exportFunction((r)=>setTimeout(r,50),unsafeWindow)),
  nativeBound: () => unsafeWindow.Promise.resolve.bind(unsafeWindow.Promise, new unsafeWindow.Promise(r=>setTimeout(r,50))),
  nativeThen: () => unsafeWindow.Promise.prototype.then.bind(new unsafeWindow.Promise(r=>setTimeout(r,50))),
  exportedAllow: () => exportFunction(() => new unsafeWindow.Promise(r=>setTimeout(r,50)),unsafeWindow,{allowCrossOriginArguments:true}),
  exportedAllowWindow: () => exportFunction(() => new window.Promise(r=>setTimeout(r,50)),unsafeWindow,{allowCrossOriginArguments:true}),
};
for (const [name, make] of Object.entries(cases)) {
  try { await Promise.race([navigator.locks.request(name,make()), new Promise((_,reject)=>setTimeout(()=>reject(Error('timeout')),1500))]); log(name+': OK'); }
  catch(e) {log(name+': '+e);}
}
log('DONE');
})();
'''
if len(sys.argv) > 1:
 code = '''const unsafeWindow = window.wrappedJSObject;
 globalThis.GM = {
 getValue: (key, fallback) => API.sendMessage({op:'get',key}).then(v=>v===null?fallback:v),
 setValue: (key,value) => API.sendMessage({op:'set',key,value}),
 deleteValue: key => API.sendMessage({op:'delete',key}),
 addValueChangeListener: (key,callback) => key,
 removeValueChangeListener: () => {},
 };
 ''' + pathlib.Path(sys.argv[1]).read_text(encoding='utf8')
api = '''browser.userScripts.onBeforeScript.addListener(script => {
script.defineGlobals({API: {async sendMessage(data){const response=await browser.runtime.sendMessage(data);return response && typeof response==='object'?script.export(response):response;}},cloneInto: (obj,target,options={})=>cloneInto(options.cloneFunctions ? obj.wrappedJSObject : obj,target,options), exportFunction});
});'''
manifest = {'manifest_version':2,'name':'Isolated FireMonkey sandbox reproduction','version':'1.0','browser_specific_settings':{'gecko':{'id':'yths-repro@example.test'}},'permissions':['storage','http://127.0.0.1/*'],'user_scripts':{'api_script':'api.js'},'background':{'scripts':['background.js']}}
with zipfile.ZipFile(BASE/'repro.xpi','w') as z:
 z.writestr('manifest.json',json.dumps(manifest)); z.writestr('api.js',api)
 z.writestr('background.js', '''browser.storage.local.clear();browser.runtime.onMessage.addListener(async data=>{if(data.op==='get')return (await browser.storage.local.get(data.key))[data.key]??null;if(data.op==='set')await browser.storage.local.set({[data.key]:data.value});if(data.op==='delete')await browser.storage.local.remove(data.key);return null;});'''+'browser.userScripts.register({matches:["http://127.0.0.1/*"],js:[{code:'+json.dumps(code)+'}],runAt:"document_end"});')
class Handler(http.server.BaseHTTPRequestHandler):
 def do_GET(self):
  self.send_response(200);self.send_header('Content-Type','text/html');self.send_header('Content-Security-Policy',"script-src 'none'; object-src 'none'");self.end_headers();self.wfile.write(b'<!doctype html><body>Waiting for test</body>')
 def log_message(self,*args): pass
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Handler)
threading.Thread(target=server.serve_forever,daemon=True).start()
profile=BASE/'profile';profile.mkdir(exist_ok=True)
(profile/'user.js').write_text('user_pref("marionette.port", 2837);\nuser_pref("browser.shell.checkDefaultBrowser",false);\n')
out=open(BASE/'firefox.log','w')
proc=subprocess.Popen([os.environ.get('FIREFOX_BINARY', 'C:/Program Files/Mozilla Firefox/firefox.exe'),'-headless','-no-remote','-profile',str(profile),'-marionette'],stdout=out,stderr=out,creationflags=subprocess.CREATE_NO_WINDOW)
try:
 for _ in range(60):
  try:
   with socket.create_connection(('127.0.0.1',2837),timeout=.5): break
  except OSError:time.sleep(.2)
 m=Marionette(host='127.0.0.1',port=2837);m.start_session()
 Addons(m).install(str(BASE/'repro.xpi'),temp=True)
 time.sleep(.5);m.navigate('http://127.0.0.1:'+str(server.server_port)+'/feed/history')
 for _ in range(60):
  result=m.execute_script('return document.body.textContent;')
  if 'DONE' in result or 'Search Local History' in result:break
  time.sleep(.2)
 print(result)
 m.delete_session()
finally:
 proc.terminate();proc.wait(timeout=10);server.shutdown();out.close()
