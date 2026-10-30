import * as api from './runtime.js';

const RELEASE='m1-close-20261030-v1',PROMPT='rock-world-lite-authority';
let active=null,opening=null,storePromise=null,lastReceipt=null,lastError=null;
const getContext=()=>SillyTavern.getContext();
const ownCard=c=>api.isSupportedCardRelease(c.characters?.[c.characterId]?.data?.extensions?.rock_world_lite?.release_id);
const identity=c=>`${c.characters?.[c.characterId]?.avatar}\n${c.chatMetadata?.integrity}\n${c.getCurrentChatId()}`;
const errorCode=e=>e?.code??e?.message??'CLIENT_ERROR';
const copy=x=>JSON.parse(JSON.stringify(x));
function requireThat(ok,code){if(!ok){const e=new Error(code);e.code=code;throw e;}}
function assertCurrent(id){requireThat(identity(getContext())===id&&ownCard(getContext()),'CHAT_CHANGED_DURING_ACTION');}
function statusElement(){
 let box=document.getElementById('rock-world-lite-status');if(box)return box;
 box=document.createElement('div');box.id='rock-world-lite-status';box.style.cssText='font-size:12px;padding:6px 10px;opacity:.9;display:flex;gap:9px;align-items:center;flex-wrap:wrap';
 const label=document.createElement('span');label.id='rock-world-lite-status-text';box.append(label);
 for(const [label,command]of[['状态','状态'],['帮助','帮助'],['导出','导出'],['导入','导入']]){const button=document.createElement('button');button.type='button';button.textContent=label;button.style.cssText='font:inherit;padding:2px 6px;cursor:pointer';button.addEventListener('click',()=>runControl(command).catch(e=>fail(e,true)));box.append(button);}
 const form=document.getElementById('send_form');if(form)form.before(box);else document.body.append(box);return box;
}
function showStatus(text){const box=statusElement();box.hidden=!ownCard(getContext());box.style.display=box.hidden?'none':'flex';box.querySelector('span').textContent=text;}
function locationText(state,bridge){
 const map=state.moduleState['world-map'].data;if(map.presence==='home')return'家园';
 const point=bridge.runtime.release.locations.find(x=>JSON.stringify(x.position)===JSON.stringify(map.position));
 if(point)return point.name;const region=bridge.runtime.release.regions.find(r=>map.current_regions.includes(r.id));
 return`${region?.name??(map.position.map_id==='academy'?'魔法学院':'大世界')} (${map.position.x}, ${map.position.y})`;
}
function authorityPrompt(state,bridge,receipt=null,extra=''){
 const movement=state.moduleState['world-map'].data;
 return`【洛克世界已保存状态】\n${JSON.stringify({release:RELEASE,revision:state.revision,worldTime:state.worldTime,player:state.moduleState.foundation.data.player,...movement})}\n`+
 `本轮回执：${JSON.stringify(receipt)}\n${extra}\n`+
 '你不能写状态、剧情事实、耗时或动作编号。仅committed回执的事实可写成已发生；duplicate代表旧动作，不能再次结算。动作候选尚未提交时只表达意图。\n'+
 '需要移动而本轮尚无回执时，可输出唯一一个<RW_ACTION>{"type":"world-map.walk","payload":{"to":{"map_id":"mainland","layer_id":"surface","x":0,"y":0}}}</RW_ACTION>，坐标必须来自已核验位置或玩家明确目标。不要填写起点、耗时、权限、story_facts。其余允许动作只有world-map.activate/teleport（source_id）、world-map.home/leave-home（空payload）、world-map.transition（transition_id）。模型动作回复会被客户端替换为真实结算结果。\n'+
 `已核验地点：${JSON.stringify(bridge.runtime.release.locations.map(p=>({name:p.name,position:p.position})))}\n魔力之源：${JSON.stringify(bridge.runtime.release.sources.map(p=>({id:p.id,name:p.name,position:p.position})))}\n`+
 '0.11.0行动时钟：玩家明确交谈、交谈：内容、说：内容按一次交谈行动1分钟；自然等待默认1分钟；明确等待/快进按玩家指定时长结算。模型不能据剧情等待期自动快进，也不能自造时长。新候选foundation.talk={}、foundation.wait/fast-forward={minutes}仅在真实玩家原文明确授权并匹配时有效。普通未标记叙述、OOC、状态查询不计时。姓名只按已保存player.name，开场姓名命令由玩家输入。若本轮已有交谈回执，继续自然对话而不要再次提交候选。\n'+
 '普通大陆区块边缘自由通行。只有独立魔法学院需已保存风眠省主线完成true。捕捉、制作、剧情奖励未开放。';
}
async function inject(ready,receipt=lastReceipt,extra=''){
 assertCurrent(ready.id);const state=await ready.bridge.snapshot();assertCurrent(ready.id);
 const currentIntent=[...getContext().chat].reverse().find(m=>m.is_user)?.extra?.rock_world_lite;
 const currentReceipt=receipt&&currentIntent?.commandId===receipt.commandId?receipt:null;
 getContext().setExtensionPrompt(PROMPT,authorityPrompt(state,ready.bridge,currentReceipt,extra),1,0,false,0);
 showStatus(`洛克世界 · ${state.moduleState.foundation.data.player.name} · ${locationText(state,ready.bridge)} · ${state.worldTime} 游戏分钟 · 已保存`);return state;
}
async function showUpgradeBackup(ready){
 assertCurrent(ready.id);const state=await ready.bridge.snapshot();assertCurrent(ready.id);const fact=state.journal.flatMap(j=>j.receipt?.narrativeFacts??[]).find(f=>f.kind==='foundation.upgraded');
 const backupId=fact?.data?.backupId;if(typeof backupId!=='string')return;
 const c=getContext();if(c.chat.some(m=>m.extra?.rock_world_lite_upgrade?.backupId===backupId))return;
 systemText(`存档已升级至0.11.0，原有位置和游戏时间已保留。升级前备份可用 /rock 备份 ${backupId} 下载；导入备份会建立独立新聊天。`,{rock_world_lite_upgrade:{backupId}});
 await c.saveChat();assertCurrent(ready.id);
}
async function request(c,endpoint,body){
 const response=await fetch(endpoint,{method:body===undefined?'GET':'POST',headers:c.getRequestHeaders(),body:body===undefined?undefined:JSON.stringify(body),cache:'no-store',signal:AbortSignal.timeout(20000)});
 requireThat(response.ok,'CLIENT_SERVER_READ_FAILED');return response.json();
}
async function getReady(){
 const c=getContext();
 if(!ownCard(c)){active=null;lastReceipt=null;lastError=null;c.setExtensionPrompt(PROMPT,'',1,0,false,0);showStatus('');return null;}
 requireThat(!c.groupId,'GROUP_CHAT_UNSUPPORTED');requireThat(typeof c.chatMetadata?.integrity==='string'&&c.chatMetadata.integrity.length>0,'CHAT_NOT_READY');
 const id=identity(c),account=await request(c,'/api/users/me');assertCurrent(id);requireThat(typeof account.handle==='string','ACCOUNT_IDENTITY_MISSING');
 const binding=await api.ensureWorldbookBinding(c);requireThat(binding.active&&binding.ready,'WORLDBOOK_NOT_READY');assertCurrent(id);
 const now=getContext().characters[getContext().characterId]?.data?.extensions;
 requireThat(now?.world===binding.bookName&&now?.rock_world_lite?.worldbook_sha256===binding.worldbookSha256,'WORLDBOOK_SCOPE_CHANGED');
 if(active?.id===id&&active.account===account.handle){active.binding=binding;active.bridge=await api.openConversation({...active.bridge.host,messages:c.chat,chatFile:c.getCurrentChatId()},active.save);assertCurrent(id);lastError=null;await showUpgradeBackup(active);return active;}
 if(opening?.id===id)return opening.promise;
 const promise=(async()=>{
  storePromise??=api.IndexedDbSavePort.open().catch(e=>{storePromise=null;throw e;});const save=await storePromise;assertCurrent(id);
  const bridge=await api.openConversation({account:account.handle,avatar:binding.avatar,integrity:c.chatMetadata.integrity,messages:c.chat,chatFile:c.getCurrentChatId()},save);assertCurrent(id);
  active={id,account:account.handle,binding,bridge,save};lastReceipt=null;lastError=null;await inject(active,null);await showUpgradeBackup(active);return active;
 })();opening={id,promise};try{return await promise;}finally{if(opening?.promise===promise)opening=null;}
}
function escapeHtml(text){return text.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function systemText(text,extra={}){getContext().sendSystemMessage('generic',escapeHtml(text).replaceAll('\n','<br>'),extra);}
async function fail(error,visible=false){
 const c=getContext();if(!ownCard(c))return;lastError=errorCode(error);
 c.setExtensionPrompt(PROMPT,`【行动未获确认】${lastError}。没有成功回执，不得叙述行动、时间、激活或奖励已经发生。请让玩家查看状态或以同一意图重试。`,1,0,false,0);
 showStatus(`洛克世界 · 无法结算：${lastError}`);c.stopGeneration?.();
 if(lastError==='CHAT_IDENTITY_COLLISION'||lastError==='CHAT_CHANGED_DURING_ACTION'){if(visible)globalThis.toastr?.warning('聊天身份发生冲突，请重新打开原聊天。迁移游戏存档请使用 /rock 导入。');return;}
 if(visible){systemText(`行动未确认：${api.movementErrorMessage(lastError)}\n已有存档未被叙述改写。可输入 /rock 状态 或 /rock 重试。`);await c.saveChat();}
}
async function persistIntent(ready,intent){
 assertCurrent(ready.id);const c=getContext();await c.saveChat();assertCurrent(ready.id);
 const read=await request(c,'/api/chats/get',{avatar_url:ready.binding.avatar,file_name:c.getCurrentChatId()});assertCurrent(ready.id);
 requireThat(Array.isArray(read)&&read[0]?.chat_metadata?.integrity===c.chatMetadata.integrity,'CHAT_SAVE_UNCONFIRMED');
 const matching=read.slice(1).find(m=>m.is_user&&m.extra?.rock_world_lite?.commandId===intent.commandId);
 requireThat(matching&&matching.extra.rock_world_lite.textSha256===intent.textSha256&&await api.sha256Text(matching.mes)===intent.textSha256,'INTENT_SAVE_UNCONFIRMED');
}
function receiptText(result,ready){
 const r=result.receipt;
 if(r.status!=='committed'&&r.status!=='duplicate')return`行动未完成：${api.movementErrorMessage(r.errorCode??r.status)}\n累计 ${result.state.worldTime} 游戏分钟。`;
 requireThat(result.committedReceipt?.status==='committed','RECEIPT_CHECKPOINT_MISSING');
 const facts=result.committedReceipt.narrativeFacts;
 const movement=facts.find(f=>f.kind==='movement.result')?.data,activation=facts.find(f=>f.kind==='movement.source-activated')?.data,clock=facts.find(f=>f.kind==='clock.result')?.data,player=facts.find(f=>f.kind==='player.identity')?.data;
 const detail=player?`姓名已保存为${player.name}。`:clock?`${clock.mode==='talk'?'交谈':clock.mode==='wait'?'等待':'快进'}已保存，${r.status==='duplicate'?'原动作':'本次'} ${clock.minutes} 游戏分钟。`:activation?`${r.status==='duplicate'?'原动作':'已'}激活${activation.name}。`:movement?`${movement.mode==='walk'?'步行':movement.mode==='home'?'回到家园':movement.mode==='leave-home'?'离开家园':'地图移动'}已保存，${r.status==='duplicate'?'原动作':'本次'} ${movement.minutes} 游戏分钟。`:'当前位置无需变化，未增加游戏时间。';
 return`${r.status==='duplicate'?'这个动作已处理，本次没有重复计时。\n':''}${detail}\n当前位置：${locationText(result.state,ready.bridge)}；累计 ${result.state.worldTime} 游戏分钟。`;
}
async function publish(result,ready,{assistantMessage=null}={}){
 assertCurrent(ready.id);lastReceipt=result.receipt;lastError=null;const text=receiptText(result,ready);
 if(assistantMessage){
  const talk=result.committedReceipt?.narrativeFacts?.some(f=>f.kind==='clock.result'&&f.data.mode==='talk'),prose=talk?assistantMessage.mes.replace(/<RW_ACTION>[\s\S]*?<\/RW_ACTION>/g,'').trim():'';
  assistantMessage.mes=prose?`${prose}\n\n【时间回执】${text}`:text;assistantMessage.extra??={};delete assistantMessage.extra.display_text;delete assistantMessage.extra.rock_world_lite_error;assistantMessage.extra.rock_world_lite_receipt=copy(result.receipt);
  if(Array.isArray(assistantMessage.swipes)&&Number.isInteger(assistantMessage.swipe_id))assistantMessage.swipes[assistantMessage.swipe_id]=assistantMessage.mes;
  if(assistantMessage.swipe_info?.[assistantMessage.swipe_id])assistantMessage.swipe_info[assistantMessage.swipe_id].extra=copy(assistantMessage.extra);
  const index=getContext().chat.indexOf(assistantMessage);if(index>=0)getContext().updateMessageBlock(index,assistantMessage);
 }else systemText(text,{rock_world_lite_receipt:copy(result.receipt)});
 await inject(ready,result.receipt);await getContext().saveChat();assertCurrent(ready.id);return text;
}
async function handleUser(index){
 const operationId=identity(getContext());
 let ready;try{
  ready=await getReady();if(!ready)return;const message=getContext().chat[index];if(!message?.is_user)return;
  const intent=await ready.bridge.bindUser(index);if(lastReceipt?.commandId!==intent.commandId)lastReceipt=null;await persistIntent(ready,intent);const candidate=ready.bridge.parsePlayer(message.mes);
  if(!candidate){await inject(ready,null,'当前用户意图尚未结算；需要移动时只给一个候选。计时交谈请让玩家使用“交谈：内容”或“说：内容”；未标记的普通叙述、OOC和未知行动不自动计时。');return;}
  const result=await ready.bridge.submit(intent,candidate);assertCurrent(ready.id);await publish(result,ready);
 }catch(e){if(identity(getContext())===operationId)await fail(e,true);}
}
async function handleAssistant(index,type){
 if(type==='first_message')return;
 const c=getContext(),operationId=identity(c),message=c.chat[index];if(!ownCard(c)||!message||message.is_user||message.is_system||!message.mes?.includes('RW_ACTION'))return;
 let ready;try{
  ready=await getReady();requireThat(ready,'CLIENT_NOT_READY');const candidate=api.extractCandidate(message.mes);requireThat(candidate,'CANDIDATE_INVALID');
  let user=index-1;while(user>=0&&!c.chat[user]?.is_user)user--;requireThat(user>=0&&c.chat[user].extra?.rock_world_lite,'USER_INTENT_REQUIRED');
  const intent=await ready.bridge.bindUser(user);await persistIntent(ready,intent);const result=await ready.bridge.submit(intent,candidate);assertCurrent(ready.id);await publish(result,ready,{assistantMessage:message});
 }catch(e){if(identity(getContext())!==operationId)return;message.mes=`行动未确认：${api.movementErrorMessage(errorCode(e))}`;message.extra??={};delete message.extra.display_text;delete message.extra.rock_world_lite_receipt;message.extra.rock_world_lite_error=errorCode(e);if(Array.isArray(message.swipes)&&Number.isInteger(message.swipe_id))message.swipes[message.swipe_id]=message.mes;if(message.swipe_info?.[message.swipe_id])message.swipe_info[message.swipe_id].extra=copy(message.extra);getContext().updateMessageBlock(index,message);await fail(e,false);await getContext().saveChat();}
}
const HELP='Lite 0.11.0：大地图步行、探索、源点激活/传送、学院进出、家园、人物姓名与行动时钟。\n新开场可输入 /rock 开场姓名 晨风（或直接说“我叫晨风”）；下一次游戏行动后姓名锁定。\n/rock 交谈 或“交谈：你好”计1游戏分钟；/rock 等待 默认1分钟；/rock 等待10分钟；/rock 快进1小时。快进须明确指定时长，每次最多30天；不会自动跳过主线等待期。未标记的普通叙述和OOC不自动计时。\n原有动作继续可用：前往学院驻地、激活魔力之源、前往月牙湖岸、传送至学院驻地、回家、离家；不调用模型时用 /rock 加动作。\n/rock 状态：查看已保存姓名、位置和时间；/rock 重试：复用上一玩家意图；/rock 导出、/rock 导入：备份或迁移；/rock 备份 备份ID：下载迁移前原文。\n更换目标请发送新消息。修改、删除、重生成历史消息不会回滚存档；回到过去请从对应消息创建聊天分支。';
function download(text,name){const url=URL.createObjectURL(new Blob([text],{type:'application/json;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function selectJson(){return new Promise(resolve=>{const input=document.createElement('input');input.type='file';input.accept='.json,application/json';input.hidden=true;document.body.append(input);input.addEventListener('change',async()=>{const file=input.files?.[0];input.remove();resolve(file?await file.text():null);},{once:true});input.addEventListener('cancel',()=>{input.remove();resolve(null);},{once:true});input.click();});}
async function importFile(ready){
 const serialized=await selectJson();if(serialized===null)return'已取消导入。';assertCurrent(ready.id);
 const c=getContext(),integrity=crypto.randomUUID(),host={account:ready.account,avatar:ready.binding.avatar,integrity},scope=await api.conversationScope(host);
 let result;try{result=await api.importBrowserSave(serialized,{save:ready.save,profile:'lite',...scope,seed:20261030,activeSaveKey:ready.bridge.runtime.gateway.key});}
 catch(e){systemText(`导入未完成：${errorCode(e)}。${e.backupVerified?`原文已备份，可输入 /rock 备份 ${e.backupId} 下载。`:'请保留原始文件。'}`);await c.saveChat();throw e;}
 assertCurrent(ready.id);const state=await ready.save.load(result.saveKey);requireThat(state,'IMPORTED_SAVE_MISSING');
 requireThat(await ready.save.recordCreate('rock-world.chat-base.v1',result.saveKey,state),'IMPORT_BASE_EXISTS');
 const fileName=`洛克世界-导入-${new Date().toISOString().replace(/[:.]/g,'-')}-${integrity.slice(0,8)}`;
 const message={name:c.characters[c.characterId].name,is_user:false,is_system:false,send_date:new Date().toISOString(),mes:`存档已导入。累计 ${state.worldTime} 游戏分钟；输入 /rock 状态 查看当前位置。\n原文备份已核对，可输入 /rock 备份 ${result.backupId} 下载。`,extra:{rock_world_lite_base:{saveKey:result.saveKey},rock_world_lite_import:{backupId:result.backupId,sourceSha256:result.sourceSha256,kind:result.kind}}};
 // This is an imported checkpoint, not a replaceable default greeting. Native
 // character edits/rename must not regenerate it and erase the branch anchor.
 const payload={avatar_url:ready.binding.avatar,ch_name:c.characters[c.characterId].name,file_name:fileName,chat:[{chat_metadata:{integrity,tainted:true},user_name:'unused',character_name:'unused'},message]};
 await request(c,'/api/chats/save',payload);const read=await request(c,'/api/chats/get',{avatar_url:ready.binding.avatar,file_name:fileName});
 requireThat(Array.isArray(read)&&read[0]?.chat_metadata?.integrity===integrity&&read[0]?.chat_metadata?.tainted===true&&read[1]?.extra?.rock_world_lite_base?.saveKey===result.saveKey&&read[1]?.extra?.rock_world_lite_import?.backupId===result.backupId&&read[1]?.mes?.includes(`/rock 备份 ${result.backupId}`),'IMPORT_CHAT_SAVE_UNCONFIRMED');
 assertCurrent(ready.id);await c.openCharacterChat(fileName);return`已导入到新聊天；原聊天保留。备份ID：${result.backupId}`;
}
async function runControl(raw){
 const text=String(raw??'').trim(),ready=await getReady();requireThat(ready,'SELECT_ROCK_WORLD_CARD');
 if(!text||['帮助','help'].includes(text)){systemText(HELP);await getContext().saveChat();return HELP;}
 if(['状态','state'].includes(text)){const state=await inject(ready);const line=`姓名：${state.moduleState.foundation.data.player.name}；当前位置：${locationText(state,ready.bridge)}；累计 ${state.worldTime} 游戏分钟；存档版本 ${state.revision}。`;systemText(line);await getContext().saveChat();return line;}
 if(['导出','export'].includes(text)){const serialized=await api.exportBrowserSave(ready.save,ready.bridge.runtime.gateway.key);download(serialized,`rock-world-lite-save-${new Date().toISOString().replace(/[:.]/g,'-')}.json`);return'当前完整存档已导出。';}
 if(['导入','import'].includes(text))return importFile(ready);
 if(text.startsWith('备份 ')){const backupId=text.slice(3).trim(),backup=backupId.startsWith('v010-')?await api.loadUpgradeBackup(ready.save,backupId):await api.loadImportBackup(ready.save,backupId);requireThat(backup!==null,'IMPORT_BACKUP_NOT_FOUND');download(backup,`rock-world-original-${backupId}.json`);return'原始备份已导出。';}
 if(['重试','retry'].includes(text)){const c=getContext();let i=c.chat.length-1;while(i>=0&&!c.chat[i]?.is_user)i--;requireThat(i>=0&&c.chat[i].extra?.rock_world_lite,'NO_PREVIOUS_INTENT');const intent=await ready.bridge.bindUser(i);await persistIntent(ready,intent);return publish(await ready.bridge.retry(intent),ready);}
 requireThat(ready.bridge.parsePlayer(text)!==null,'ACTION_NOT_RECOGNIZED');
 const c=getContext(),message={name:c.name1,is_user:true,is_system:false,send_date:new Date().toISOString(),mes:text,extra:{}};
 c.chat.push(message);c.addOneMessage(message);await c.eventSource.emit(c.eventTypes.USER_MESSAGE_RENDERED,c.chat.length-1);return lastError?`行动未确认：${lastError}`:'玩家意图已处理；详见聊天回执。';
}
async function refresh(){const operationId=identity(getContext());try{const ready=await getReady();if(ready)await inject(ready);}catch(e){if(identity(getContext())===operationId)await fail(e,false);}}
async function edited(index){const c=getContext();if(!ownCard(c))return;try{const ready=await getReady();if(ready&&c.chat[index]?.is_user&&c.chat[index].extra?.rock_world_lite)await ready.bridge.bindUser(index);await refresh();}catch(e){await fail(e,true);}}
async function renamed(event){
 const c=getContext();if(!ownCard(c)||event.groupId||event.avatarId!==c.characters[c.characterId]?.avatar)return;
 try{const account=await request(c,'/api/users/me'),sanitized=await request(c,'/api/files/sanitize-filename',{fileName:event.newFileName});requireThat(typeof sanitized.fileName==='string'&&sanitized.fileName.endsWith('.jsonl'),'CHAT_RENAME_UNCONFIRMED');const newName=sanitized.fileName.replace(/\.jsonl$/,''),oldName=event.oldFileName.replace(/\.jsonl$/,'');
  const chat=await request(c,'/api/chats/get',{avatar_url:event.avatarId,file_name:newName});requireThat(Array.isArray(chat)&&chat[0]?.chat_metadata?.integrity,'CHAT_RENAME_UNCONFIRMED');
  storePromise??=api.IndexedDbSavePort.open().catch(e=>{storePromise=null;throw e;});
  await api.renameConversationFile({account:account.handle,avatar:event.avatarId,integrity:chat[0].chat_metadata.integrity},await storePromise,oldName,newName);active=null;await refresh();
 }catch(e){await fail(e,false);}
}
const initial=getContext();
initial.SlashCommandParser.addCommandObject(initial.SlashCommand.fromProps({name:'rock',callback:async(_args,value)=>{try{return await runControl(value);}catch(e){await fail(e,true);return`行动未确认：${errorCode(e)}`;}},unnamedArgumentList:[initial.SlashCommandArgument.fromProps({description:'洛克世界动作、状态、重试、导入或导出',typeList:[initial.ARGUMENT_TYPE.STRING],isRequired:false})],helpString:HELP}));
initial.eventSource.on(initial.eventTypes.APP_READY,refresh);
initial.eventSource.on(initial.eventTypes.CHAT_CHANGED,refresh);
initial.eventSource.on(initial.eventTypes.CHAT_RENAMED,renamed);
initial.eventSource.on(initial.eventTypes.GENERATION_AFTER_COMMANDS,refresh);
initial.eventSource.on(initial.eventTypes.USER_MESSAGE_RENDERED,handleUser);
initial.eventSource.on(initial.eventTypes.MESSAGE_RECEIVED,handleAssistant);
initial.eventSource.on(initial.eventTypes.MESSAGE_SWIPED,async index=>{const message=getContext().chat[index];if(message?.mes?.includes('RW_ACTION'))await handleAssistant(index,'swipe');else await refresh();});
initial.eventSource.on(initial.eventTypes.MESSAGE_DELETED,refresh);
initial.eventSource.on(initial.eventTypes.MESSAGE_EDITED,edited);
initial.eventSource.on(initial.eventTypes.MESSAGE_UPDATED,edited);
globalThis.RockWorldLite=Object.freeze({release:RELEASE,diagnostics:async()=>({release:RELEASE,ready:!!active&&active.id===identity(getContext())&&!lastError,error:lastError,binding:active?.id===identity(getContext())?copy(active.binding):null,saveCapability:active?.save.capability??'none',state:active?.id===identity(getContext())?await active.bridge.snapshot():null,lastReceipt:copy(lastReceipt)})});
