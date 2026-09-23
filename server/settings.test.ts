import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { createAiSettings } = require('./settings.cjs');
const directories: string[] = [];
const KEY = 'sk-test-fixture-not-a-real-key';
const safeStorage = {
  isAsyncEncryptionAvailable: async () => true,
  encryptStringAsync: async (value:string) => Buffer.from([...Buffer.from(value)].map(b=>b^173)),
  decryptStringAsync: async (value:Buffer) => ({result:Buffer.from([...value].map(b=>b^173)).toString('utf8')}),
};
const createAutofill = ({env}: {env?:Record<string,string>}) => {
  const key = env?.OPENAI_API_KEY || '';
  const model = env?.OPENAI_MODEL || 'gpt-6-sol';
  return {
    getAiStatus: () => ({available:!!key,model}),
    autofill: async () => ({ model }),
    withModel: (nextModel:string) => createAutofill({env:{OPENAI_API_KEY:key,OPENAI_MODEL:nextModel}}),
  };
};
async function setup(overrides={}) {
  const directory=await mkdtemp(path.join(tmpdir(),'luma-settings-'));directories.push(directory);
  const options={directory,safeStorage,createAutofill,envPath:path.join(directory,'missing.env'),platform:'win32',...overrides};
  return {directory,options,settings:await createAiSettings(options)};
}
afterEach(async()=>{for(const directory of directories.splice(0)){if(path.dirname(path.resolve(directory))!==path.resolve(tmpdir())||!path.basename(directory).startsWith('luma-settings-'))throw new Error('Unexpected test directory');await rm(directory,{recursive:true,force:true});}});
describe('Desktop API settings',()=>{
  it('stores only ciphertext and reopens it without revealing the key in status',async()=>{
    const {directory,options,settings}=await setup();
    expect((await settings.getSettings()).model).toBe('gpt-6-sol');
    const result=await settings.save({key:KEY,model:'gpt-6-sol'});
    expect(JSON.stringify(result)).not.toContain(KEY);
    const serialized=await readFile(path.join(directory,'ai-settings.json'),'utf8');
    expect(serialized).not.toContain(KEY);
    expect(Object.keys(JSON.parse(serialized)).sort()).toEqual(['encryptedKey','model','version']);
    expect(JSON.parse(serialized).version).toBe(2);
    const reopened=await createAiSettings(options);
    expect(await reopened.getSettings()).toMatchObject({available:true,source:'saved',saved:true});
    expect(await reopened.autofill({})).toEqual({model:'gpt-6-sol'});
    const switched=await reopened.save({key:'',model:'gpt-6-luna'});
    expect(switched).toMatchObject({available:true,source:'saved',model:'gpt-6-luna'});
    expect(JSON.parse(await readFile(path.join(directory,'ai-settings.json'),'utf8')).encryptedKey).toBe(JSON.parse(serialized).encryptedKey);
    expect((await createAiSettings(options)).getAiStatus()).toEqual({available:true,model:'gpt-6-luna'});
  });
  it('persists a model choice without an API key and restores the default when removed',async()=>{
    const {directory,options,settings}=await setup();
    expect(await settings.save({key:'',model:'gpt-6-luna'})).toMatchObject({available:false,model:'gpt-6-luna',saved:false,hasStoredSettings:true});
    expect(JSON.parse(await readFile(path.join(directory,'ai-settings.json'),'utf8'))).toEqual({version:2,model:'gpt-6-luna'});
    const reopened=await createAiSettings(options);
    expect(reopened.getAiStatus()).toEqual({available:false,model:'gpt-6-luna'});
    expect(await reopened.remove()).toMatchObject({model:'gpt-6-sol',hasStoredSettings:false});
  });
  it('keeps an environment key active when saving only a model preference',async()=>{
    const fromEnvironment = ({env}: {env?:Record<string,string>}) => createAutofill({env:{OPENAI_API_KEY:env?.OPENAI_API_KEY || KEY,OPENAI_MODEL:env?.OPENAI_MODEL || 'gpt-6-sol'}});
    const {directory,options,settings}=await setup({createAutofill:fromEnvironment});
    expect(await settings.save({key:'',model:'gpt-6-luna'})).toMatchObject({available:true,source:'environment',saved:false,model:'gpt-6-luna'});
    expect(JSON.parse(await readFile(path.join(directory,'ai-settings.json'),'utf8'))).toEqual({version:2,model:'gpt-6-luna'});
    const reopened=await createAiSettings(options);
    expect(await reopened.getSettings()).toMatchObject({available:true,source:'environment',model:'gpt-6-luna'});
    expect(await reopened.remove()).toMatchObject({available:true,model:'gpt-6-sol',source:'environment'});
  });
  it('migrates an older saved model to Sol without losing its encrypted key',async()=>{
    const {directory,options}=await setup();
    const encrypted=await safeStorage.encryptStringAsync(KEY);
    await writeFile(path.join(directory,'ai-settings.json'),JSON.stringify({version:1,model:'gpt-5.4-mini',encryptedKey:encrypted.toString('base64')}));
    const settings=await createAiSettings(options);
    expect(await settings.getSettings()).toMatchObject({available:true,source:'saved',model:'gpt-6-sol',warning:''});
    await settings.save({key:'',model:'gpt-6-luna'});
    expect(JSON.parse(await readFile(path.join(directory,'ai-settings.json'),'utf8'))).toEqual({version:2,model:'gpt-6-luna',encryptedKey:encrypted.toString('base64')});
  });
  it('rejects plaintext key storage but permits a model-only preference without encryption',async()=>{
    const {directory,options,settings}=await setup({safeStorage:{...safeStorage,isAsyncEncryptionAvailable:async()=>false}});
    await expect(settings.save({key:KEY,model:'gpt-6-sol'})).rejects.toThrow('安全に保存');
    await expect(readFile(path.join(directory,'ai-settings.json'))).rejects.toMatchObject({code:'ENOENT'});
    expect(await settings.save({key:'',model:'gpt-6-luna'})).toMatchObject({available:false,model:'gpt-6-luna',saved:false});
    expect(JSON.parse(await readFile(path.join(directory,'ai-settings.json'),'utf8'))).toEqual({version:2,model:'gpt-6-luna'});
    expect((await createAiSettings(options)).getAiStatus().model).toBe('gpt-6-luna');
  });
  it('retains working settings when encryption fails',async()=>{
    const storage={...safeStorage,encryptStringAsync:vi.fn(safeStorage.encryptStringAsync)};
    const {directory,settings}=await setup({safeStorage:storage});await settings.save({key:KEY,model:'gpt-6-sol'});
    const before=await readFile(path.join(directory,'ai-settings.json'),'utf8');
    storage.encryptStringAsync.mockRejectedValueOnce(new Error('should-never-leak-'+KEY));
    await expect(settings.save({key:KEY,model:'gpt-6-luna'})).rejects.toThrow('暗号化できません');
    expect(await readFile(path.join(directory,'ai-settings.json'),'utf8')).toBe(before);
    expect(settings.getAiStatus().model).toBe('gpt-6-sol');
  });
  it('handles corrupted storage without disclosing its contents',async()=>{
    const {directory,options}=await setup();await writeFile(path.join(directory,'ai-settings.json'),KEY);
    const settings=await createAiSettings(options);
    const status=await settings.getSettings();expect(status.warning).toContain('読み込めません');expect(JSON.stringify(status)).not.toContain(KEY);
    expect(status.hasStoredSettings).toBe(true);
    await expect(settings.save({key:'',model:'gpt-6-luna'})).rejects.toThrow('読み込めないAI設定');
    expect(await readFile(path.join(directory,'ai-settings.json'),'utf8')).toBe(KEY);
    await settings.remove();
    expect((await settings.getSettings()).hasStoredSettings).toBe(false);
    await expect(readFile(path.join(directory,'ai-settings.json'))).rejects.toMatchObject({code:'ENOENT'});
  });
  it('removes saved credentials and serializes concurrent changes',async()=>{
    const {directory,settings}=await setup();await Promise.all([settings.save({key:KEY,model:'gpt-6-sol'}),settings.remove()]);
    expect(settings.getAiStatus().available).toBe(false);
    await expect(readFile(path.join(directory,'ai-settings.json'))).rejects.toMatchObject({code:'ENOENT'});
  });
  it('rejects the Linux plaintext fallback and malformed keys',async()=>{
    const {settings}=await setup({platform:'linux',safeStorage:{...safeStorage,getSelectedStorageBackend:()=> 'basic_text'}});
    expect((await settings.getSettings()).canStore).toBe(false);
    const valid=await setup();await expect(valid.settings.save({key:'Bearer '+KEY,model:'gpt-6-sol'})).rejects.toThrow('APIキー');
    await expect(valid.settings.save({key:'',model:'unlisted-model'})).rejects.toThrow('GPT-6 Sol');
  });
});
