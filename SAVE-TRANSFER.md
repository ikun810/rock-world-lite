# 浏览器存档传输与受限旧档迁移

本组件提供明确的文件导入/导出操作，使用原 M1-04 领域注册表和现有 IndexedDbSavePort。导出读取真实已保存世界；导入先持久化原始文本，再验证和转换，最后只用 create-only CAS 创建新作用域。当前存档与输入文件不被覆盖。

## UI 接口

```ts
exportBrowserSave(save, saveKey, assetBase?): Promise<string>

importBrowserSave(serialized, {
  save,
  profile,
  sessionKey,
  branchId,
  seed,
  assetBase?,
  actorId?,
  activeSaveKey?,
}): Promise<SaveImportResult>

loadImportBackup(save, backupId): Promise<string | null>
```

`save` 为现有 IndexedDbSavePort，或转发到该真实后端的窄包装器。运行期检查要求 `capability === 'atomicCAS'`、`recordCreate` 和 `recordGet`。没有内存替代后端。

成功返回：

```ts
{
  status: 'imported',
  kind: 'm105' | 'legacy-v09',
  saveKey: string,
  backupId: string,
  sourceSha256: string,
  warnings: string[],
  migrationPolicyVersion?: 'm104-legacy-v09-mapping-v1',
}
```

导入失败抛出 `SaveTransferError`，包含 `code`、`backupId?`、`sourceSha256?`、`saveKey?`、`backupVerified` 和原始 `cause?`。只有 `backupVerified === true` 才表示本次输入已经成功保存并逐字读回；仅存在 backupId 不代表写入已确认。

示例：

```ts
const text = await file.text();
const result = await importBrowserSave(text, {
  save,
  profile: 'lite',
  sessionKey: newChatSessionKey,
  branchId: newChatBranchId,
  seed: 42,
  assetBase: new URL('data/', runtimeModuleUrl),
  activeSaveKey: currentSaveKey,
});
```

宿主负责创建独立聊天、计算真实 session/branch 身份和选择该聊天。本组件不切换聊天、不重写消息、不自行把导入结果当作玩家动作。`branchId === 'main'`、目标等于 activeSaveKey、目标等于现代文件的原始 source scope，以及目标已经存在时均拒绝导入。导入不同聊天的合法 branch 标识（例如 `chat:<hash>`）不受限制。

`exportBrowserSave` 在存档不存在时抛 `SAVE_NOT_FOUND`，不会调用初始化操作来虚构一份可导出的进度。

## 现代传输格式

格式名为 `rock-world.save-transfer`，format_version 为 1。JSON 包含六个字段：

| 字段 | 内容与校验 |
|---|---|
| `format` | 必须为固定格式名 |
| `format_version` | 必须为 1；不自动解释未知版本 |
| `release` | client_release_id、movement_release、rules_version、map_sha256，逐项绑定当前已核验的浏览器资料 |
| `source` | save_key、profile、session_key、branch_id、revision，必须与 world 的真实作用域及 revision 一致 |
| `world_sha256` | 原 core canonical(world) 的 UTF-8 SHA-256 |
| `world` | 完整 WorldState，包括所有 moduleState、worldTime、rngState、scheduler、journal、receipts 和已有 lineage |

release、source 和封套字段集合必须完全符合此版本。未知字段、错误版本、错误资料 hash、错误 scope、错误 checksum 都拒绝。对 world 复用原 `validateState` 和生产 movement registry；模块、位置、场景、时钟、scheduler、journal、版本等校验不会因为 checksum 正确而跳过。

导入 JSON 同时拒绝语法错误、重复成员名（包括 `name` 与 `n\u0061me` 这种转义后重名）、非有限数值、危险对象键及原 core 禁止的 JSON 结构。重复字段检测是传输边界上的歧义拒绝，不修改上游旧档映射代码。最大输入文本为 8 MiB，检查发生在原文备份之后；实际世界仍服从原 core 的 4 MiB canonical save 限制和其它结构限制。导出采用紧凑 JSON，避免格式缩进使合法存档超过传输封套限制。

导入同 profile 的完整 world 后，仅将 sessionKey、branchId 改为宿主指定新作用域，并将 lineage 指向导入前的 branch/revision。原世界时钟、随机状态、模块状态、任务、历史命令和回执不重新计算。Lite 与 Full 之间禁止转换；现代 Full 文件只能导入新的 Full 作用域。

world_sha256 用于完整性检查，不是来源签名。此 API 的调用边界是用户明确选择文件后的可信宿主操作；它不属于模型行动白名单，也没有开放可写 story_facts、奖励或任意领域状态的游戏命令。合法文件中的既有状态仍须通过生产领域验证，checksum 本身不证明外部文件来源。

## 原文备份与失败次序

在尝试解析 JSON 之前，组件会：

1. 捕获目标 scope、seed、assetBase 和 activeSaveKey，防止异步回调改变目的地。
2. 计算输入字符串的 UTF-8 SHA-256，生成独立随机 backupId。
3. 使用 `recordCreate('rock-world.save-transfer.backups.v1', backupId, record)` 保存原始文本。
4. 从同一真实 IDB 后端读回完整备份记录，并逐字段校验完全一致。
5. 标记 backupVerified，随后才解析、验证和准备新世界。

备份记录包含 format、version、source_sha256 和 raw。raw 是传给 API 的原始字符串，空白、换行、中文和转义写法均保留；组件不会重新序列化它来替代原文。这是解码后的文本备份，不声称保留任意原文件编码的二进制字节。

损坏文本、未知旧档、无法映射的位置、不支持的人物进度、错误版本或已经存在的导入目标均留下已确认原文备份，并返回受控拒绝。UI 可以通过 `loadImportBackup` 取回该原文；读取时会再次核验备份 hash。备份是浏览器本地 IDB 记录，不是异地备份。

备份与世界是两个独立事务，次序固定为“备份完成且读回一致 → 验证完成 → 新世界 create-only commit”。这允许拒绝或中断后仅留下备份，但不会允许世界先写入而原文尚未备份。

世界提交返回 saved 后还会读回新 scope 并核对完整快照。提交或提交后读回抛错时，返回 `IMPORT_COMMIT_UNKNOWN`：新世界可能已经存在。错误中的 saveKey 是本次唯一目标，宿主应检查该 scope；不能在结果不明时自动改用另一个新 scope 继续宣称成功。再次向相同已存在目标导入会得到 `IMPORT_TARGET_EXISTS`，不会覆盖已有世界。

常见错误：

| code | 含义 |
|---|---|
| `SAVE_NOT_FOUND` | 没有可导出的已保存世界 |
| `UNSAFE_STORAGE` / `IMPORT_BACKUP_REQUIRED` | 未提供合格存储能力 |
| `IMPORT_BACKUP_FAILED` | 原文备份写入或读回失败，禁止目标提交 |
| `IMPORT_BACKUP_MISMATCH` | 备份读回与原文不一致，禁止目标提交 |
| `IMPORT_JSON_INVALID` | JSON 语法无效；原文仍可恢复 |
| `IMPORT_DUPLICATE_JSON_KEY` | 同一对象中存在重复成员名 |
| `IMPORT_FORMAT_VERSION_UNSUPPORTED` | 传输格式版本不支持 |
| `IMPORT_RELEASE_MISMATCH` | 传输文件资料/规则/客户端绑定不符 |
| `IMPORT_SOURCE_SCOPE_MISMATCH` | source 元数据与完整 world 不一致 |
| `IMPORT_WORLD_HASH_MISMATCH` | world 完整性校验不一致 |
| `IMPORT_TARGET_BRANCH_REQUIRED` | 不允许导入 main branch |
| `IMPORT_ACTIVE_SCOPE_FORBIDDEN` | 目标为宿主当前 scope |
| `IMPORT_SOURCE_SCOPE_FORBIDDEN` | 目标仍是现代文件的原始 scope |
| `IMPORT_TARGET_EXISTS` | create-only 竞争失败，目标保持已有内容 |
| `IMPORT_COMMIT_UNKNOWN` | 目标写入/确认结果不明，需检查错误所指 scope |
| `CROSS_PROFILE_MIGRATION_FORBIDDEN` | Lite/Full 跨 profile 导入或旧档迁往 Full |

原领域校验和旧档解析错误码保持原值，可与上述 wrapper 错误区分。

## 命令历史与新聊天重放

现代导入完整保留每条旧 commandId、fingerprint 和 receipt。**不清空 journal，不因 session 变化重新计算旧 fingerprint，不把历史命令重新执行。**

- 新聊天使用新的 sessionKey。用旧 commandId 再提交同类型/负载时，原 Gateway 计算的新 fingerprint 含新的 sessionKey，与存档旧 fingerprint 不同，因此返回 `conflict / ID_CONFLICT`。测试确认 revision 和时间均不增加。
- 同 session 的独立新 branch 保留相同命令身份。完整旧命令原样重试返回 duplicate；不会重复计时。
- 旧 v0.9 的 transactionLog 迁为 `fingerprint: null` tombstone。任何旧 ID 重放返回 `conflict / LEGACY_COMMAND_REPLAY`。
- 玩家在新聊天明确发起的新动作，由消息桥生成新的稳定意图 ID。这是新动作，不是隐式恢复旧动作。

对于导入聊天的开场分支，宿主应保存导入完成后的完整初始快照及其实际 scope 引用。它与后续动作 checkpoint 属于不同时间点。旧 journal 中的所有历史 ID 不代表这个新聊天已经存在对应消息前缀；没有历史基准或对应 checkpoint 时不能用最新状态代替。

## 固定 M1-04 旧档迁移

组件直接调用固定上游 `prepareLegacyMigration`。上游文件 `vendor/m104/src/migration.ts` 未修改；其 SHA-256 为：

`2f946651372ca3a110d9e6e80e7e4996269f0b3d8fe7aa75636b29a202b716df`

浏览器构建对该文件执行四处各一次的机械替换：

1. Node `createHash` 导入换为浏览器 `sha256Text`。
2. Node `createMovementRuntime`/MovementRuntimeOptions 导入换为浏览器 `createBrowserMovementRuntime`/BrowserMovementOptions，并保留原本地别名。
3. prepare 中 serialized 的同步 SHA-256 表达式换为 `await sha256Text(serialized)`。
4. 原 commit 函数中 proposed.backup 的同步 SHA-256 表达式换为 `await sha256Text(proposed.backup)`；本传输组件不调用该旧 commit 函数。

构建首先校验原文件 hash，并要求每个原表达式恰好出现一次。具体替换字符串、转换后 hash 及 `readLegacyAndPolicyUnchanged` 证据见 `reports/save-transfer-migration-transform.json`。旧档 policy 和 readLegacy 的源码片段逐字不变。转换后的 browser bundle 无外部/Node imports。

旧档迁移 policy 仍为 `m104-legacy-v09-mapping-v1`，受限范围保持如下：

| 原始旧档情况 | 实际行为 |
|---|---|
| 原 v0.9 `createInitialState` 默认魔法师之家，x/y 为 null | 映射到固定新参考起点 `(433755, 705660)`，保持原时钟 |
| 精确旧魔法师之家坐标 `(-765.7, 982.5)` | 同一明确映射；不是跨坐标平面换算 |
| 精确 `place.I130311110307771` / `sim.home` 且 x/y 为 null | 新 state 为 home presence，位置使用固定家园外点 `(461330, 646100)` |
| 原 clock 为 137 分钟 | 保留 137；不补发时间、动作、事件或奖励 |
| 原 transactionLog 有两个 ID | 保留两个 revision 0 的不可重放 tombstone |
| 玩家姓名及旧 known 等元数据 | 原文备份完整保留；不冒称完成完整人物系统迁移 |
| 未映射地点、坐标或历史 | 保留原文，按原代码拒绝，不默默开新档 |
| 非空 inventory/story/relationships/pets/decorations | 保留原文，以原 unsupported-state 错误拒绝 |
| 旧激活传送数据 | 原映射缺失则拒绝 |
| 老 ARCH/INTEG 快照缺少可识别旧位置 | `LEGACY_POSITION_MISSING`；不会重置为新出生点 |
| Full 旧档或旧档目标为 Full | 拒绝 |

没有传输封套的现代 raw WorldState 也不被自动猜测为合法版本化文件。它会保留备份并由原识别逻辑拒绝；应使用 `exportBrowserSave` 生成完整绑定格式。

## 真实验证与复现

`tests/save-transfer.mjs` 使用实际 Chromium 151.0.7922.34、Playwright、临时 HTTP origin 和真正 IndexedDB。它独立执行相同四处 pinned 构建转换，运行浏览器版本，同时在 Node 侧调用未改动上游迁移函数作输出对照。没有 fake-indexeddb。

```sh
M105_BROWSER_EXECUTABLE=/absolute/path/to/chrome-headless-shell \
M105_TRANSFER_PHASE=green \
node tests/save-transfer.mjs
```

此次浏览器路径为 `/tmp/m105-browsers/cft-151.0.7922.34/chrome-headless-shell-linux64/chrome-headless-shell`。测试需本地 loopback 服务与浏览器子进程权限；在默认沙箱限制之外经过自动审核后执行。

证据文件：

- `reports/save-transfer-red.json/.log`：初始 25 项 RED，25 项均因缺少实现而失败。
- `reports/save-transfer-duplicate-red.json/.log`：补充重复 JSON 字段回归前，25/26 通过，新用例实际捕获错误接受。
- `reports/save-transfer-green.json/.log`：最终 **26/26 通过**。
- `reports/save-transfer-typecheck.log`：严格 TypeScript 检查，exit 0。
- `reports/save-transfer-migration-transform.json`：固定来源及机械转换证据。

26 项包含真实移动进度的导出/再次导入；新旧 session 的命令重放边界；备份先于提交；目标/source/active/profile 隔离；11 类 metadata 错误、9 类 domain 错误、7 类损坏/未知 JSON；重复字段及转义重名；3 个原 v0.9 产物/明确旧形式与未改动上游逐状态一致；12 类旧档拒绝；备份写入及读回失败；回调不能改目标；提交前失败和确认丢失；create-only 并发；资料篡改；导出领域验证；刷新与连接重开后的真实读取。

故障测试包装真实 IDB 后端，不暴露生产故障开关。确认丢失测试先实际提交再抛错；配额类测试为边界故障注入，未声称物理磁盘耗尽。这里的组件验证不等同于用户实际 SillyTavern/MVU 版本或完整聊天 UI 验收；宿主整体结果另见客户端验收报告。
