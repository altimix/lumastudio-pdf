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
const createAutofill = ({env}: {env?:Record<string,string>}) => ({
  getAiStatus: () => ({available:!!env?.OPENAI_API_KEY,model:env?.OPENAI_MODEL || 'gpt-5.4-mini'}),
  autofill: async () => ({ model:env?.OPENAI_MODEL || 'none' }),
});
async function setup(overrides={}) {
  const directory=await mkdtemp(path.join(tmpdir(),'luma-settings-'));directories.push(directory);
  const options={directory,safeStorage,createAutofill,envPath:path.join(directory,'missing.env'),platform:'win32',...overrides};
  return {directory,options,settings:await createAiSettings(options)};
}
afterEach(async()=>{for(const directory of directories.splice(0)){if(path.dirname(path.resolve(directory))!==path.resolve(tmpdir())||!path.basename(directory).startsWith('luma-settings-'))throw new Error('Unexpected test directory');await rm(directory,{recursive:true,force:true});}});
describe('Desktop API settings',()=>{
  it('stores only ciphertext and reopens it without revealing the key in status',async()=>{
    const {directory,options,settings}=await setup();
    const result=await settings.save({key:KEY,model:'gpt-5.4-mini'});
    expect(JSON.stringify(result)).not.toContain(KEY);
    const serialized=await readFile(path.join(directory,'ai-settings.json'),'utf8');
    expect(serialized).not.toContain(KEY);
    expect(Object.keys(JSON.parse(serialized)).sort()).toEqual(['encryptedKey','model','version']);
    const reopened=await createAiSettings(options);
    expect(await reopened.getSettings()).toMatchObject({available:true,source:'saved',saved:true});
    expect(await reopened.autofill({})).toEqual({model:'gpt-5.4-mini'});
  });
  it('rejects unavailable encryption instead of saving plaintext',async()=>{
    const {directory,settings}=await setup({safeStorage:{...safeStorage,isAsyncEncryptionAvailable:async()=>false}});
    await expect(settings.save({key:KEY,model:'gpt-5.4-mini'})).rejects.toThrow('安全に保存');
    await expect(readFile(path.join(directory,'ai-settings.json'))).rejects.toMatchObject({code:'ENOENT'});
  });
  it('retains working settings when encryption fails',async()=>{
    const storage={...safeStorage,encryptStringAsync:vi.fn(safeStorage.encryptStringAsync)};
    const {directory,settings}=await setup({safeStorage:storage});await settings.save({key:KEY,model:'gpt-5.4-mini'});
    const before=await readFile(path.join(directory,'ai-settings.json'),'utf8');
    storage.encryptStringAsync.mockRejectedValueOnce(new Error('should-never-leak-'+KEY));
    await expect(settings.save({key:KEY,model:'changed'})).rejects.toThrow('暗号化できません');
    expect(await readFile(path.join(directory,'ai-settings.json'),'utf8')).toBe(before);
    expect(settings.getAiStatus().model).toBe('gpt-5.4-mini');
  });
  it('handles corrupted storage without disclosing its contents',async()=>{
    const {directory,options}=await setup();await writeFile(path.join(directory,'ai-settings.json'),KEY);
    const settings=await createAiSettings(options);
    const status=await settings.getSettings();expect(status.warning).toContain('読み込めません');expect(JSON.stringify(status)).not.toContain(KEY);
    expect(status.hasStoredSettings).toBe(true);
    await settings.remove();
    expect((await settings.getSettings()).hasStoredSettings).toBe(false);
    await expect(readFile(path.join(directory,'ai-settings.json'))).rejects.toMatchObject({code:'ENOENT'});
  });
  it('removes saved credentials and serializes concurrent changes',async()=>{
    const {directory,settings}=await setup();await Promise.all([settings.save({key:KEY,model:'gpt-5.4-mini'}),settings.remove()]);
    expect(settings.getAiStatus().available).toBe(false);
    await expect(readFile(path.join(directory,'ai-settings.json'))).rejects.toMatchObject({code:'ENOENT'});
  });
  it('rejects the Linux plaintext fallback and malformed keys',async()=>{
    const {settings}=await setup({platform:'linux',safeStorage:{...safeStorage,getSelectedStorageBackend:()=> 'basic_text'}});
    expect((await settings.getSettings()).canStore).toBe(false);
    const valid=await setup();await expect(valid.settings.save({key:'Bearer '+KEY,model:'gpt-5.4-mini'})).rejects.toThrow('APIキー');
  });
});
