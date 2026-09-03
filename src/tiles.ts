// ============ 全自定义功能插件 - 磁贴注册表 ============
// OneBot v11 全部内置接口磁贴 + 系统控制磁贴
import { TileDef, ReturnField } from './types'

// 通用参数：OneBot 调用的结果可保存到变量（默认存到 lastResult）
const RESULT_PARAM = {
  key: 'resultVar',
  label: '结果保存变量',
  type: 'text' as const,
  default: 'lastResult',
  placeholder: '如 lastResult',
  hint: '接口调用结果会以 JSON 文本存入该变量，后续步骤可用 {lastResult} 引用；留空则不保存',
}

function onebot(
  id: string,
  api: string,
  label: string,
  category: string,
  description: string,
  params: TileDef['params'],
  color?: string,
): TileDef {
  return {
    id, api, label, category, description,
    kind: 'onebot',
    params: [...params, RESULT_PARAM],
    apiParams: params.map((p) => p.key),
    color,
  }
}

// ---------------- 消息类 ----------------
const CAT_MSG = '消息操作'
// ---------------- 群操作类 ----------------
const CAT_GROUP = '群聊操作'
// ---------------- 好友与请求类 ----------------
const CAT_FRIEND = '好友与请求'
// ---------------- 信息查询类 ----------------
const CAT_QUERY = '信息查询'
// ---------------- 文件媒体类 ----------------
const CAT_FILE = '文件媒体'
// ---------------- 系统维护类 ----------------
const CAT_SYS = '系统维护'

// 通用参数片段
function groupIdParam(required = true): TileDef['params'][number] {
  return { key: 'group_id', label: '群号', type: 'text', required, placeholder: '如 123456789', hint: '支持 {groupId} 等变量' }
}
function userIdParam(label = 'QQ号', required = true): TileDef['params'][number] {
  return { key: 'user_id', label, type: 'text', required, placeholder: '如 987654321', hint: '支持 {userId} 等变量' }
}
function messageIdParam(): TileDef['params'][number] {
  return { key: 'message_id', label: '消息ID', type: 'text', required: true, placeholder: '如 1357999', hint: '支持 {messageId} 等变量' }
}

const onebotTiles: TileDef[] = [
  // ============ 消息操作 ============
  onebot('ob.send_private_msg', 'send_private_msg', '发送私聊消息', CAT_MSG, '向指定 QQ 用户发送私聊消息', [
    userIdParam(),
    { key: 'message', label: '消息内容', type: 'textarea', required: true, placeholder: '要发送的内容，支持 {变量} 与 CQ码' },
  ], '#4f7cff'),
  onebot('ob.send_group_msg', 'send_group_msg', '发送群消息', CAT_MSG, '向指定群发送消息', [
    groupIdParam(),
    { key: 'message', label: '消息内容', type: 'textarea', required: true, placeholder: '要发送的内容，支持 {变量} 与 CQ码' },
  ], '#4f7cff'),
  onebot('ob.send_msg', 'send_msg', '自动发送消息', CAT_MSG, '按消息类型自动选择发送到私聊或群', [
    { key: 'message_type', label: '消息类型', type: 'select', default: 'group', options: [
      { label: '私聊', value: 'private' }, { label: '群聊', value: 'group' },
    ] },
    { key: 'user_id', label: 'QQ号（私聊时）', type: 'text', placeholder: '支持 {userId}' },
    { key: 'group_id', label: '群号（群聊时）', type: 'text', placeholder: '支持 {groupId}' },
    { key: 'message', label: '消息内容', type: 'textarea', required: true, placeholder: '支持 {变量} 与 CQ码' },
  ], '#4f7cff'),
  onebot('ob.delete_msg', 'delete_msg', '撤回消息', CAT_MSG, '按消息ID撤回消息', [
    messageIdParam(),
  ], '#ff7a45'),
  onebot('ob.get_msg', 'get_msg', '获取消息', CAT_MSG, '获取指定消息的详细信息', [
    messageIdParam(),
  ], '#36cfc9'),
  onebot('ob.get_forward_msg', 'get_forward_msg', '获取合并转发', CAT_MSG, '获取合并转发消息内容', [
    { key: 'id', label: '合并转发ID', type: 'text', required: true, placeholder: '合并转发消息的 id' },
  ], '#36cfc9'),
  onebot('ob.send_group_forward_msg', 'send_group_forward_msg', '发送合并转发', CAT_MSG, '向群发送合并转发消息（messages 为 JSON 数组，建议用变量注入）', [
    groupIdParam(),
    { key: 'messages', label: '消息列表(JSON)', type: 'textarea', placeholder: '[{"type":"node","data":{"name":"","uin":"","content":""}}]' },
  ], '#4f7cff'),
  onebot('ob.send_group_sign', 'send_group_sign', '群签到', CAT_MSG, '在指定群完成签到打卡', [
    groupIdParam(),
  ], '#4f7cff'),

  // ============ 群聊操作 ============
  onebot('ob.set_group_kick', 'set_group_kick', '群组踢人', CAT_GROUP, '将指定用户移出群聊', [
    groupIdParam(),
    userIdParam(),
    { key: 'reject_add_request', label: '拒绝再次加群', type: 'boolean', default: false },
  ], '#ff4d4f'),
  onebot('ob.set_group_ban', 'set_group_ban', '群组禁言', CAT_GROUP, '禁言指定用户', [
    groupIdParam(),
    userIdParam(),
    { key: 'duration', label: '时长(秒)', type: 'number', default: 600, min: 1, hint: '0 表示解除禁言' },
  ], '#ff7a45'),
  onebot('ob.set_group_anonymous_ban', 'set_group_anonymous_ban', '群匿名禁言', CAT_GROUP, '禁言群内匿名用户', [
    groupIdParam(),
    { key: 'flag', label: '匿名标志', type: 'text', required: true, placeholder: '匿名用户标识' },
    { key: 'duration', label: '时长(秒)', type: 'number', default: 600, min: 1 },
  ], '#ff7a45'),
  onebot('ob.set_group_whole_ban', 'set_group_whole_ban', '全体禁言', CAT_GROUP, '开启或关闭全体禁言', [
    groupIdParam(),
    { key: 'enable', label: '开启禁言', type: 'boolean', default: true },
  ], '#ff7a45'),
  onebot('ob.set_group_admin', 'set_group_admin', '设置群管理员', CAT_GROUP, '设置或取消群管理员', [
    groupIdParam(),
    userIdParam(),
    { key: 'enable', label: '设为管理员', type: 'boolean', default: true },
  ], '#ff7a45'),
  onebot('ob.set_group_anonymous', 'set_group_anonymous', '群匿名设置', CAT_GROUP, '开启或关闭群匿名聊天', [
    groupIdParam(),
    { key: 'enable', label: '开启匿名', type: 'boolean', default: true },
  ], '#ff7a45'),
  onebot('ob.set_group_card', 'set_group_card', '设置群名片', CAT_GROUP, '设置用户在群内的名片（留空清除）', [
    groupIdParam(),
    userIdParam(),
    { key: 'card', label: '名片内容', type: 'text', placeholder: '留空表示清除名片' },
  ], '#ff7a45'),
  onebot('ob.set_group_name', 'set_group_name', '设置群名', CAT_GROUP, '修改群名称', [
    groupIdParam(),
    { key: 'group_name', label: '新群名', type: 'text', required: true },
  ], '#ff7a45'),
  onebot('ob.set_group_special_title', 'set_group_special_title', '设置专属头衔', CAT_GROUP, '设置用户群专属头衔', [
    groupIdParam(),
    userIdParam(),
    { key: 'special_title', label: '头衔', type: 'text', required: true },
    { key: 'duration', label: '时长(秒)', type: 'number', default: -1, hint: '-1 表示永久' },
  ], '#ff7a45'),
  onebot('ob.set_group_leave', 'set_group_leave', '退出群聊', CAT_GROUP, '机器人退出指定群聊', [
    groupIdParam(),
    { key: 'is_dismiss', label: '解散群', type: 'boolean', default: false, hint: '仅群主可解散' },
  ], '#ff4d4f'),
  onebot('ob.set_group_portrait', 'set_group_portrait', '设置群头像', CAT_GROUP, '设置群聊头像（本地路径 / URL / base64）', [
    groupIdParam(),
    { key: 'file', label: '头像文件', type: 'text', required: true, placeholder: '本地路径或URL或base64' },
  ], '#ff7a45'),
  onebot('ob.set_essence_msg', 'set_essence_msg', '设置精华消息', CAT_GROUP, '将消息设置为群精华', [
    messageIdParam(),
  ], '#ffc53d'),
  onebot('ob.delete_essence_msg', 'delete_essence_msg', '移出精华消息', CAT_GROUP, '将消息移出群精华', [
    messageIdParam(),
  ], '#ffc53d'),

  // ============ 好友与请求 ============
  onebot('ob.send_like', 'send_like', '好友点赞', CAT_FRIEND, '给指定 QQ 点赞', [
    userIdParam(),
    { key: 'times', label: '次数', type: 'number', default: 1, min: 1, max: 20 },
  ], '#b37feb'),
  onebot('ob.set_friend_add_request', 'set_friend_add_request', '处理好友请求', CAT_FRIEND, '处理好友添加请求', [
    { key: 'flag', label: '请求标志', type: 'text', required: true, placeholder: '请求 flag' },
    { key: 'approve', label: '是否同意', type: 'boolean', default: true },
    { key: 'remark', label: '备注', type: 'text', placeholder: '同意后的备注' },
  ], '#b37feb'),
  onebot('ob.set_group_add_request', 'set_group_add_request', '处理加群请求', CAT_FRIEND, '处理加群/邀请请求', [
    { key: 'flag', label: '请求标志', type: 'text', required: true, placeholder: '请求 flag' },
    { key: 'sub_type', label: '请求类型', type: 'select', default: 'add', options: [
      { label: '加群申请', value: 'add' }, { label: '邀请入群', value: 'invite' },
    ] },
    { key: 'approve', label: '是否同意', type: 'boolean', default: true },
    { key: 'reason', label: '拒绝理由', type: 'text', placeholder: '拒绝时填写' },
  ], '#b37feb'),

  // ============ 信息查询 ============
  onebot('ob.get_login_info', 'get_login_info', '获取登录号信息', CAT_QUERY, '获取机器人自己的账号信息', [], '#36cfc9'),
  onebot('ob.get_stranger_info', 'get_stranger_info', '获取陌生人信息', CAT_QUERY, '获取用户基本信息', [
    userIdParam(),
    { key: 'no_cache', label: '不使用缓存', type: 'boolean', default: false },
  ], '#36cfc9'),
  onebot('ob.get_friend_list', 'get_friend_list', '获取好友列表', CAT_QUERY, '获取机器人全部好友列表', [], '#36cfc9'),
  onebot('ob.get_group_info', 'get_group_info', '获取群信息', CAT_QUERY, '获取群基本信息', [
    groupIdParam(),
    { key: 'no_cache', label: '不使用缓存', type: 'boolean', default: false },
  ], '#36cfc9'),
  onebot('ob.get_group_list', 'get_group_list', '获取群列表', CAT_QUERY, '获取机器人所在群列表', [], '#36cfc9'),
  onebot('ob.get_group_member_info', 'get_group_member_info', '获取群成员信息', CAT_QUERY, '获取指定群成员信息', [
    groupIdParam(),
    userIdParam(),
    { key: 'no_cache', label: '不使用缓存', type: 'boolean', default: false },
  ], '#36cfc9'),
  onebot('ob.get_group_member_list', 'get_group_member_list', '获取群成员列表', CAT_QUERY, '获取群成员列表', [
    groupIdParam(),
    { key: 'no_cache', label: '不使用缓存', type: 'boolean', default: false },
  ], '#36cfc9'),
  onebot('ob.get_group_honor_info', 'get_group_honor_info', '获取群荣誉', CAT_QUERY, '获取群荣誉信息', [
    groupIdParam(),
    { key: 'type', label: '荣誉类型', type: 'select', default: 'all', options: [
      { label: '全部', value: 'all' }, { label: '龙王', value: 'talkative' },
      { label: '群聊之火', value: 'performer' }, { label: '群聊炽焰', value: 'legend' },
      { label: '冒尖小萌新', value: 'strong_newbie' }, { label: '快乐之源', value: 'emotion' },
    ] },
  ], '#36cfc9'),
  onebot('ob.get_group_msg_history', 'get_group_msg_history', '获取群消息历史', CAT_QUERY, '获取群历史消息（依赖框架支持）', [
    groupIdParam(),
    { key: 'message_seq', label: '起始消息序号', type: 'number', hint: '留空则从最新开始' },
  ], '#36cfc9'),
  onebot('ob.get_cookies', 'get_cookies', '获取Cookies', CAT_QUERY, '获取登录 cookie', [
    { key: 'domain', label: '域名', type: 'text', placeholder: '如 qq.com' },
  ], '#36cfc9'),
  onebot('ob.get_csrf_token', 'get_csrf_token', '获取CSRF Token', CAT_QUERY, '获取 CSRF Token', [], '#36cfc9'),
  onebot('ob.get_credentials', 'get_credentials', '获取凭据', CAT_QUERY, '获取 Cookie 与 CSRF Token', [
    { key: 'domain', label: '域名', type: 'text', placeholder: '如 qq.com' },
  ], '#36cfc9'),

  // ============ 文件媒体 ============
  onebot('ob.get_record', 'get_record', '获取语音', CAT_FILE, '获取语音文件链接', [
    { key: 'file', label: '文件参数', type: 'text', required: true, placeholder: '语音文件名或URL' },
    { key: 'out_format', label: '输出格式', type: 'select', default: 'mp3', options: [
      { label: 'mp3', value: 'mp3' }, { label: 'amr', value: 'amr' }, { label: 'wma', value: 'wma' },
      { label: 'm4a', value: 'm4a' }, { label: 'spx', value: 'spx' }, { label: 'ogg', value: 'ogg' },
      { label: 'wav', value: 'wav' }, { label: 'flac', value: 'flac' },
    ] },
  ], '#9254de'),
  onebot('ob.get_image', 'get_image', '获取图片', CAT_FILE, '获取图片文件链接', [
    { key: 'file', label: '文件参数', type: 'text', required: true, placeholder: '图片文件名或URL' },
  ], '#9254de'),
  onebot('ob.ocr_image', 'ocr_image', '图片OCR', CAT_FILE, '识别图片文字', [
    { key: 'image', label: '图片', type: 'text', required: true, placeholder: '图片文件名或URL' },
  ], '#9254de'),
  onebot('ob.get_group_file_system_info', 'get_group_file_system_info', '群文件系统信息', CAT_FILE, '获取群文件系统信息', [
    groupIdParam(),
  ], '#9254de'),
  onebot('ob.get_group_root_files', 'get_group_root_files', '群根目录文件', CAT_FILE, '获取群根目录文件列表', [
    groupIdParam(),
  ], '#9254de'),
  onebot('ob.get_group_files_by_folder', 'get_group_files_by_folder', '群子目录文件', CAT_FILE, '获取群子目录文件列表', [
    groupIdParam(),
    { key: 'folder_id', label: '目录ID', type: 'text', required: true, placeholder: '目录 id' },
  ], '#9254de'),
  onebot('ob.upload_group_file', 'upload_group_file', '上传群文件', CAT_FILE, '向群上传文件', [
    groupIdParam(),
    { key: 'file', label: '文件', type: 'text', required: true, placeholder: '本地路径或URL' },
    { key: 'name', label: '文件名', type: 'text', required: true, placeholder: '展示的文件名' },
    { key: 'folder', label: '目录ID', type: 'text', placeholder: '留空为根目录' },
  ], '#9254de'),
  onebot('ob.can_send_image', 'can_send_image', '能否发图', CAT_FILE, '检查能否发送图片', [], '#9254de'),
  onebot('ob.can_send_record', 'can_send_record', '能否发语音', CAT_FILE, '检查能否发送语音', [], '#9254de'),

  // ============ 系统维护 ============
  onebot('ob.get_status', 'get_status', '获取运行状态', CAT_SYS, '获取 OneBot 实现运行状态', [], '#5cdbd3'),
  onebot('ob.get_version_info', 'get_version_info', '获取版本信息', CAT_SYS, '获取 OneBot 实现版本', [], '#5cdbd3'),
  onebot('ob.clean_cache', 'clean_cache', '清理缓存', CAT_SYS, '清理 OneBot 实现缓存', [], '#5cdbd3'),
]

// ---------------- 磁贴接口返回字段说明 ----------------
// 依据 OneBot v11 接口文档逐一列出各接口 JSON 返回的全部可用字段，
// 供条件判断「取值字段（JSON 路径）」输入时参考（取数磁贴可比较这些字段）
const R = (rows: [string, string, string, string?][]): ReturnField[] => rows.map(([field, type, meaning, source]) => ({ field, type, meaning, source }))
// 保持元组数组，供 R([...ID_NICK, ...]) 复用（不可提前经 R 转换）
const ID_NICK: [string, string, string, string?][] = [
  ['user_id', 'number', 'QQ 号', '被查询/消息对应用户'],
  ['nickname', 'string', '昵称', '用户资料'],
]
const RETURNS: Record<string, ReturnField[]> = {
  // ============ 消息操作 ============
  'ob.send_private_msg': R([['message_id', 'number', '发送成功后的消息 ID', '本接口返回']]),
  'ob.send_group_msg': R([['message_id', 'number', '发送成功后的消息 ID', '本接口返回']]),
  'ob.send_msg': R([['message_id', 'number', '发送成功后的消息 ID', '本接口返回']]),
  'ob.delete_msg': R([]),
  'ob.get_msg': R([
    ['message_id', 'number', '消息 ID', '本接口返回'],
    ['real_id', 'number', '消息真实 ID（收发消息事件中的 message_id）', '本接口返回'],
    ['message_type', 'string', '消息类型：private/group', '本接口返回'],
    ['sender', 'object', '发送者信息对象（见下）', '消息发送者资料'],
    ['sender.user_id', 'number', '发送者 QQ 号', '消息发送者'],
    ['sender.nickname', 'string', '发送者昵称', '消息发送者'],
    ['sender.card', 'string', '发送者在群内名片（群消息时有效）', '消息发送者'],
    ['sender.role', 'string', '发送者群角色：owner/admin/member（群消息时有效）', '消息发送者'],
    ['message', 'object', '消息内容（CQ 码数组）', '本接口返回'],
    ['raw_message', 'string', '原始消息文本', '本接口返回'],
    ['time', 'number', '发送时间（Unix 时间戳）', '本接口返回'],
  ]),
  'ob.get_forward_msg': R([
    ['message', 'array', '合并转发消息节点数组（type=node）', '本接口返回'],
    ['message.0.type', 'string', '消息段类型（node 表示转发节点）', '消息段'],
    ['message.0.data', 'object', '节点数据：name/uin/content 等', '消息段'],
    ['message.0.data.name', 'string', '节点发送者昵称', '转发节点'],
    ['message.0.data.uin', 'string', '节点发送者 QQ 号', '转发节点'],
    ['message.0.data.content', 'string', '节点内容（CQ 码序列）', '转发节点'],
  ]),
  'ob.send_group_forward_msg': R([['message_id', 'number', '发送成功后的消息 ID', '本接口返回']]),
  'ob.send_group_sign': R([]),

  // ============ 群聊操作 ============
  'ob.set_group_kick': R([]),
  'ob.set_group_ban': R([]),
  'ob.set_group_anonymous_ban': R([]),
  'ob.set_group_whole_ban': R([]),
  'ob.set_group_admin': R([]),
  'ob.set_group_anonymous': R([]),
  'ob.set_group_card': R([]),
  'ob.set_group_name': R([]),
  'ob.set_group_special_title': R([]),
  'ob.set_group_leave': R([]),
  'ob.set_group_portrait': R([]),
  'ob.set_essence_msg': R([]),
  'ob.delete_essence_msg': R([]),

  // ============ 好友与请求 ============
  'ob.send_like': R([]),
  'ob.set_friend_add_request': R([]),
  'ob.set_group_add_request': R([]),

  // ============ 信息查询 ============
  'ob.get_login_info': R([
    ['user_id', 'number', '机器人自身 QQ 号', '本接口返回'],
    ['nickname', 'string', '机器人自身昵称', '本接口返回'],
  ]),
  'ob.get_stranger_info': R([
    ...ID_NICK,
    ['sex', 'string', '性别：male/female/unknown', '用户资料'],
    ['age', 'number', '年龄（实际可能为 0 或 -1）', '用户资料'],
  ]),
  'ob.get_friend_list': R([
    ['[i]', 'object', '好友数组第 i 个元素（括号占位，实际无该键）', '好友列表'],
    ['[i].user_id', 'number', '好友 QQ 号', '好友数据'],
    ['[i].nickname', 'string', '好友昵称', '好友数据'],
    ['[i].remark', 'string', '好友备注名（可为空）', '好友数据'],
  ]),
  'ob.get_group_info': R([
    ['group_id', 'number', '群号', '本接口返回'],
    ['group_name', 'string', '群名称', '本接口返回'],
    ['member_count', 'number', '当前群成员数', '本接口返回'],
    ['max_member_count', 'number', '群成员人数上限', '本接口返回'],
  ]),
  'ob.get_group_list': R([
    ['[i].group_id', 'number', '群号', '群列表数据'],
    ['[i].group_name', 'string', '群名称', '群列表数据'],
    ['[i].member_count', 'number', '当前群成员数', '群列表数据'],
    ['[i].max_member_count', 'number', '群成员人数上限', '群列表数据'],
  ]),
  'ob.get_group_member_info': R([
    ['group_id', 'number', '群号', '本接口返回'],
    ...ID_NICK,
    ['card', 'string', '群名片（可为空）', '本接口返回'],
    ['sex', 'string', '性别：male/female/unknown', '用户资料'],
    ['age', 'number', '年龄', '用户资料'],
    ['area', 'string', '地区（部分框架返回空）', '用户资料'],
    ['level', 'string', '群等级（部分框架返回空）', '本接口返回'],
    ['role', 'string', '群角色：owner/admin/member', '本接口返回'],
    ['title', 'string', '专属头衔（可为空）', '本接口返回'],
    ['title_expire_time', 'number', '专属头衔过期时间（Unix 时间戳），0 为永久', '本接口返回'],
    ['card_changeable', 'boolean', '是否允许修改群名片', '本接口返回'],
    ['shut_up_timestamp', 'number', '禁言到期时间（Unix 时间戳），0 为未禁言', '本接口返回'],
    ['join_time', 'number', '入群时间（Unix 时间戳）', '本接口返回'],
    ['last_sent_time', 'number', '最后发言时间（Unix 时间戳）', '本接口返回'],
  ]),
  'ob.get_group_member_list': R([
    ['[i].user_id', 'number', '成员 QQ 号', '群成员数据'],
    ['[i].nickname', 'string', '成员昵称', '群成员数据'],
    ['[i].card', 'string', '成员群名片（可为空）', '群成员数据'],
    ['[i].sex', 'string', '性别：male/female/unknown', '群成员数据'],
    ['[i].age', 'number', '年龄', '群成员数据'],
    ['[i].role', 'string', '群角色：owner/admin/member', '群成员数据'],
    ['[i].title', 'string', '专属头衔（可为空）', '群成员数据'],
    ['[i].shut_up_timestamp', 'number', '禁言到期时间戳，0 为未禁言', '群成员数据'],
    ['[i].join_time', 'number', '入群时间（Unix 时间戳）', '群成员数据'],
    ['[i].last_sent_time', 'number', '最后发言时间（Unix 时间戳）', '群成员数据'],
  ]),
  'ob.get_group_honor_info': R([
    ['group_id', 'number', '群号', '本接口返回'],
    ['current_talkative', 'object', '当前龙王信息对象', '本接口返回'],
    ['current_talkative.user_id', 'number', '当前龙王 QQ 号', '本接口返回'],
    ['current_talkative.nickname', 'string', '当前龙王昵称', '本接口返回'],
    ['current_talkative.day_count', 'number', '龙王持续天数', '本接口返回'],
    ['talkative_list', 'array', '历史龙王列表（每项含 user_id/nickname/avatar/day_count）', '本接口返回'],
    ['performer_list', 'array', '群聊之火列表（每项含 user_id/nickname/avatar/day_count）', '本接口返回'],
    ['legend_list', 'array', '群聊炽焰列表（每项含 user_id/nickname/avatar/day_count）', '本接口返回'],
    ['strong_newbie_list', 'array', '冒尖小萌新列表（每项含 user_id/nickname/avatar/day_count）', '本接口返回'],
    ['emotion_list', 'array', '快乐之源列表（每项含 user_id/nickname/avatar/day_count）', '本接口返回'],
  ]),
  'ob.get_group_msg_history': R([
    ['messages', 'array', '历史消息数组（结构同 get_msg）', '本接口返回'],
    ['messages.0.message_id', 'number', '消息 ID', '历史消息'],
    ['messages.0.message', 'object', '消息内容（CQ 码数组）', '历史消息'],
    ['messages.0.time', 'number', '发送时间（Unix 时间戳）', '历史消息'],
    ['messages.0.user_id', 'number', '发送者 QQ 号', '历史消息'],
  ]),
  'ob.get_cookies': R([['cookies', 'string', 'Cookie 文本（可包含多个 key=value）', '本接口返回']]),
  'ob.get_csrf_token': R([['token', 'number', 'CSRF Token', '本接口返回']]),
  'ob.get_credentials': R([
    ['cookies', 'string', 'Cookie 文本', '本接口返回'],
    ['token', 'number', 'CSRF Token', '本接口返回'],
  ]),

  // ============ 文件媒体 ============
  'ob.get_record': R([['file', 'string', '语音文件 base64（未配置录音返回则为 URL）', '本接口返回']]),
  'ob.get_image': R([
    ['file', 'string', '图片缓存文件名', '本接口返回'],
    ['url', 'string', '图片下载 URL', '本接口返回'],
  ]),
  'ob.ocr_image': R([
    ['texts', 'array', '识别文本段数组', '本接口返回'],
    ['texts.0.text', 'string', '识别出的文本内容', 'OCR 结果'],
    ['texts.0.confidence', 'number', '置信度（0~100）', 'OCR 结果'],
    ['texts.0.coordinates', 'array', '文本框坐标 [[左上],[右上],[右下],[左下]] 或 null', 'OCR 结果'],
    ['language', 'string', '识别语言（部分框架返回）', '本接口返回'],
  ]),
  'ob.get_group_file_system_info': R([
    ['file_count', 'number', '文件总数', '本接口返回'],
    ['total_count', 'number', '所有文件数量上限', '本接口返回'],
    ['used_space', 'number', '已使用的空间（字节）', '本接口返回'],
    ['free_space', 'number', '剩余空间（字节）', '本接口返回'],
  ]),
  'ob.get_group_root_files': R([
    ['folders', 'array', '根目录文件夹数组', '本接口返回'],
    ['folders.0.folder_id', 'string', '文件夹 id', '群文件'],
    ['folders.0.folder_name', 'string', '文件夹名称', '群文件'],
    ['folders.0.create_time', 'number', '创建时间（Unix 时间戳）', '群文件'],
    ['files', 'array', '根目录文件数组', '本接口返回'],
    ['files.0.file_id', 'string', '文件 id', '群文件'],
    ['files.0.file_name', 'string', '文件名', '群文件'],
    ['files.0.busid', 'number', '文件类型标识', '群文件'],
    ['files.0.file_size', 'number', '文件大小（字节）', '群文件'],
    ['files.0.upload_time', 'number', '上传时间（Unix 时间戳）', '群文件'],
  ]),
  'ob.get_group_files_by_folder': R([
    ['folders', 'array', '子目录文件夹数组（结构同根目录）', '本接口返回'],
    ['files', 'array', '子目录文件数组（结构同根目录）', '本接口返回'],
  ]),
  'ob.upload_group_file': R([]),
  'ob.can_send_image': R([['yes', 'boolean', '是否支持发送图片', '本接口返回']]),
  'ob.can_send_record': R([['yes', 'boolean', '是否支持发送语音', '本接口返回']]),

  // ============ 系统维护 ============
  'ob.get_status': R([
    ['online', 'boolean', '是否在线', '本接口返回'],
    ['good', 'boolean', '是否良好可用（各框架扩展字段略有差异）', '本接口返回'],
  ]),
  'ob.get_version_info': R([
    ['app_name', 'string', 'OneBot 实现名称（如 NapCat/LLOneBot）', '本接口返回'],
    ['app_version', 'string', 'OneBot 实现版本号', '本接口返回'],
    ['protocol_version', 'string', 'OneBot 协议版本（v11）', '本接口返回'],
  ]),
  'ob.clean_cache': R([]),
}

// 工具磁贴统一的结果保存参数（默认不保存，留空则不写入变量）
const TOOL_RESULT_PARAM: TileDef['params'][number] = {
  key: 'resultVar',
  label: '结果保存变量',
  type: 'text',
  default: '',
  placeholder: '如 toolResult',
  hint: '工具的运行结果（文本/JSON）存入该变量，后续步骤可用 {变量名} 引用；留空则仅输出到执行日志',
}

// ---------------- Koishi 信息 / 代码工具磁贴 ----------------
const CAT_KOISHI = 'Koishi 信息'
const CAT_TOOL = '代码工具'

const toolTiles: TileDef[] = [
  {
    id: 'sys.koishi_status',
    label: 'Koishi 状态',
    category: CAT_KOISHI,
    kind: 'action',
    description: '输出 Koishi 运行状态：核心版本、Node 版本、运行时长、已加载插件数、机器人数量、内存占用、CPU 使用率、任务累计执行次数',
    color: '#13c2c2',
    params: [TOOL_RESULT_PARAM],
    exampleNote: '示例：读取 Koishi 核心版本、内存占用与 CPU 使用率，并存入变量引用',
    returns: R([
      ['koishiVersion', 'string', 'Koishi 核心版本号', '本磁贴运行时采集'],
      ['nodeVersion', 'string', 'Node.js 版本号（如 v20.11.0）', '本磁贴运行时采集'],
      ['uptimeSec', 'number', '进程已运行时长（秒）', '本磁贴运行时采集'],
      ['uptimeText', 'string', '人类可读运行时长（如 1天3小时5分10秒）', '本磁贴运行时采集'],
      ['pluginCount', 'number', '当前已加载的插件数量', '本磁贴运行时采集'],
      ['botCount', 'number', '已接入的机器人数量', '本磁贴运行时采集'],
      ['memoryMB', 'number', '进程内存占用（MB，rss 取整）', '本磁贴运行时采集'],
      ['cpuPercent', 'number', 'CPU 使用率（%，最近两次采样差值估算）', '本磁贴运行时采集'],
      ['totalTaskRuns', 'number', '本插件全部任务累计执行次数', '数据库统计'],
    ]),
  },
  {
    id: 'sys.bot_status',
    label: '机器人状态',
    category: CAT_KOISHI,
    kind: 'action',
    description: '列出当前 Koishi 已连接的机器人：平台、账号（selfId）、在线状态',
    color: '#36cfc9',
    params: [TOOL_RESULT_PARAM],
    exampleNote: '示例：统计机器人在线状态，判断是否存在离线机器人',
    returns: R([
      ['[i]', 'object', '机器人数组第 i 个元素', '机器人列表'],
      ['[i].platform', 'string', '机器人平台标识（如 onebot / discord）', '机器人信息'],
      ['[i].selfId', 'string', '机器人账号 ID', '机器人信息'],
      ['[i].status', 'string', '连接状态（online / offline 等）', '机器人信息'],
      ['[i].online', 'boolean', '是否在线（status 基于 offline 判定）', '机器人信息'],
      ['[i].name', 'string', '机器人昵称（可能为空）', '机器人资料'],
    ]),
  },
  {
    id: 'sys.json_tool',
    label: 'JSON 解析/序列化',
    category: CAT_TOOL,
    kind: 'action',
    description: 'JSON.parse 解析文本为对象、JSON.stringify 序列化并可选美化缩进；解析失败会给出原因',
    color: '#faad14',
    params: [
      {
        key: 'mode', label: '操作', type: 'select', default: 'parse', options: [
          { label: '解析 JSON（parse）', value: 'parse' }, { label: '序列化（stringify）', value: 'stringify' },
        ],
      },
      { key: 'input', label: '输入内容', type: 'textarea', required: true, placeholder: 'parse：{"key":"value"}；stringify：支持 {变量} 的文本' },
      { key: 'pretty', label: '美化缩进', type: 'boolean', default: true },
      TOOL_RESULT_PARAM,
    ],
    examples: {
      mode: 'parse',
      input: '{"groupId":123456,"nickname":"小助手","members":[{"userId":1,"name":"甲"}]}',
      pretty: true,
    },
    exampleNote: '解析下面这段 OneBot 风格 JSON，得到可引用/可比较的对象文本',
  },
  {
    id: 'sys.xml_tool',
    label: 'XML 解析/格式化',
    category: CAT_TOOL,
    kind: 'action',
    description: '将 XML 文本解析为 JSON 树（标签/属性/文本/子节点），或对 XML 做美化缩进输出',
    color: '#faad14',
    params: [
      {
        key: 'mode', label: '操作', type: 'select', default: 'parse', options: [
          { label: '解析为 JSON（parse）', value: 'parse' }, { label: '美化缩进（format）', value: 'format' },
        ],
      },
      { key: 'input', label: 'XML 内容', type: 'textarea', required: true, placeholder: '如 <note><to>张三</to><from>小助手</from></note>' },
      TOOL_RESULT_PARAM,
    ],
    examples: {
      mode: 'parse',
      input: '<note id="1"><to>张三</to><from>小助手</from><body>这是一条示例 XML</body></note>',
    },
    exampleNote: '把上面这段 XML 解析为 JSON 树，可结合「取值字段」进一步提取',
  },
  {
    id: 'sys.random',
    label: '随机数生成',
    category: CAT_TOOL,
    kind: 'action',
    description: '生成随机内容：整数、浮点数、随机字符串或 UUID（基于 crypto，不可预测）',
    color: '#faad14',
    params: [
      {
        key: 'type', label: '类型', type: 'select', default: 'int', options: [
          { label: '整数（min~max）', value: 'int' }, { label: '浮点数（min~max）', value: 'float' },
          { label: '随机字符串', value: 'string' }, { label: 'UUID v4', value: 'uuid' },
        ],
      },
      { key: 'min', label: '最小值', type: 'number', default: 1 },
      { key: 'max', label: '最大值', type: 'number', default: 100, hint: '含两端' },
      { key: 'length', label: '字符串长度', type: 'number', default: 8, min: 1, max: 64, hint: '类型为「随机字符串」时生效' },
      { key: 'chars', label: '字符集（可选）', type: 'text', default: '', placeholder: '留空为字母+数字' },
      TOOL_RESULT_PARAM,
    ],
    examples: { type: 'int', min: 1000, max: 9999 },
    exampleNote: '示例：生成 1000~9999 的随机整数（如验证码）',
  },
  {
    id: 'sys.time',
    label: '时间日期',
    category: CAT_TOOL,
    kind: 'action',
    description: '当前时间、时间戳、格式化输出（YYYY-MM-DD HH:mm:ss）、按秒偏移计算（如 60 分钟前）',
    color: '#faad14',
    params: [
      {
        key: 'mode', label: '操作', type: 'select', default: 'format', options: [
          { label: '格式化输出', value: 'format' }, { label: 'Unix 时间戳（秒）', value: 'timestamp' },
          { label: '时间偏移（秒）', value: 'offset' },
        ],
      },
      { key: 'format', label: '格式', type: 'text', default: 'YYYY-MM-DD HH:mm:ss', placeholder: 'YYYY：年 MM：月 DD：日 HH：时 mm：分 ss：秒' },
      { key: 'offsetSec', label: '偏移量（秒）', type: 'number', default: 0, hint: '如 -3600 为 1 小时前，3600 为 1 小时后（含时区换算）' },
      TOOL_RESULT_PARAM,
    ],
    examples: { mode: 'offset', format: 'YYYY-MM-DD HH:mm:ss', offsetSec: -3600 },
    exampleNote: '示例：计算 1 小时前的时间并格式化输出',
  },
  {
    id: 'sys.string_tool',
    label: '字符串处理',
    category: CAT_TOOL,
    kind: 'action',
    description: 'MD5/SHA1/SHA256 哈希、Base64 编解码、URL 编解码、大小写与去空格（基于 node:crypto）',
    color: '#8c8c8c',
    params: [
      {
        key: 'op', label: '操作', type: 'select', default: 'md5', options: [
          { label: 'MD5 哈希', value: 'md5' }, { label: 'SHA1 哈希', value: 'sha1' },
          { label: 'SHA256 哈希', value: 'sha256' }, { label: 'Base64 编码', value: 'base64_encode' },
          { label: 'Base64 解码', value: 'base64_decode' }, { label: 'URL 编码', value: 'url_encode' },
          { label: 'URL 解码', value: 'url_decode' }, { label: '转大写', value: 'upper' },
          { label: '转小写', value: 'lower' }, { label: '去除首尾空格', value: 'trim' },
        ],
      },
      { key: 'input', label: '输入文本', type: 'textarea', required: true, placeholder: '要处理的文本，支持 {变量}' },
      TOOL_RESULT_PARAM,
    ],
    examples: { op: 'md5', input: 'Hello Koishi' },
    exampleNote: '示例：计算 Hello Koishi 的 MD5 摘要（32 位十六进制）',
  },
  {
    id: 'sys.array_tool',
    label: '数组操作',
    category: CAT_TOOL,
    kind: 'action',
    description: '输入 JSON 数组文本，执行排序、去重、反转、统计长度、过滤等操作，输出结果为 JSON',
    color: '#8c8c8c',
    params: [
      {
        key: 'op', label: '操作', type: 'select', default: 'dedup', options: [
          { label: '去重（dedup）', value: 'dedup' }, { label: '小到大排序（sortAsc）', value: 'sortAsc' },
          { label: '大到小排序（sortDesc）', value: 'sortDesc' }, { label: '反转（reverse）', value: 'reverse' },
          { label: '长度（length）', value: 'length' }, { label: '去空/去假值（compact）', value: 'compact' },
          { label: '深拷贝示例（deepCopy）', value: 'deepCopy' },
        ],
      },
      { key: 'input', label: 'JSON 数组', type: 'textarea', required: true, placeholder: '[3,1,2,3,4,2] 或 [{"id":1},{"id":2}]' },
      TOOL_RESULT_PARAM,
    ],
    examples: { op: 'dedup', input: '[3,1,2,3,4,2,5,1]' },
    exampleNote: '示例：对 [3,1,2,3,4,2,5,1] 去重得到 [3,1,2,4,5]',
  },
]

// ---------------- 系统磁贴 ----------------
const systemTiles: TileDef[] = [
  {
    id: 'sys.if',
    label: '条件判断',
    category: '流程控制',
    kind: 'control',
    description: '在「条件规则区」添加取值磁贴并配置比较规则（如 结果 == 123456），按全部满足/任一满足执行对应分支',
    color: '#722ed1',
    params: [
      {
        key: 'logic', label: '判定方式', type: 'select', default: 'and', options: [
          { label: '全部规则满足（AND）', value: 'and' }, { label: '任一规则满足（OR）', value: 'or' },
        ], hint: '条件由下方「条件规则区」的子磁贴自动生成，无需手动填写表达式',
      },
    ],
  },
  {
    id: 'sys.loop_count',
    label: '次数循环(for)',
    category: '流程控制',
    kind: 'control',
    description: '按指定次数循环执行内部步骤',
    color: '#13c2c2',
    params: [
      { key: 'count', label: '循环次数', type: 'number', required: true, min: 1, max: 100000, placeholder: '如 10' },
      { key: 'var', label: '循环变量名', type: 'text', default: 'i', hint: '每次循环将当前次序号写入该变量，可用 {i} 引用（从 1 开始）' },
    ],
  },
  {
    id: 'sys.loop_while',
    label: '条件循环(while)',
    category: '流程控制',
    kind: 'control',
    description: '条件成立时反复执行内部步骤（有最大次数保护）',
    color: '#13c2c2',
    params: [
      { key: 'condition', label: '循环条件', type: 'textarea', required: true, placeholder: '如 {count} < 10' },
      { key: 'max_iter', label: '最大次数', type: 'number', default: 100, min: 1, max: 100000, hint: '防止无限循环' },
    ],
  },
  {
    id: 'sys.break',
    label: '跳出循环',
    category: '流程控制',
    kind: 'control',
    description: '跳出当前所在的最内层循环，仅可在循环内部步骤中使用',
    color: '#5cdbd3',
    params: [],
  },
  {
    id: 'sys.continue',
    label: '跳过本次循环',
    category: '流程控制',
    kind: 'control',
    description: '跳过当前循环的本次剩余步骤，进入下一次循环',
    color: '#5cdbd3',
    params: [],
  },
  {
    id: 'sys.wait',
    label: '延时等待',
    category: '流程控制',
    kind: 'control',
    description: '暂停指定时间后再继续执行',
    color: '#fa8c16',
    params: [
      { key: 'ms', label: '时长(毫秒)', type: 'number', required: true, min: 100, placeholder: '如 3000', hint: '100 毫秒 = 0.1 秒' },
    ],
  },
  {
    id: 'sys.var_set',
    label: '设置变量',
    category: '变量与日志',
    kind: 'action',
    description: '将文本或表达式计算结果存入变量，供后续步骤引用',
    color: '#faad14',
    params: [
      { key: 'var', label: '变量名', type: 'text', required: true, placeholder: '如 count', hint: '仅英文字母、数字、下划线' },
      {
        key: 'mode', label: '取值方式', type: 'select', default: 'text', options: [
          { label: '文本（模板拼接）', value: 'text' }, { label: '表达式（计算结果）', value: 'expr' },
        ], hint: '文本：直接替换 {变量}；表达式：按算术/比较/逻辑语法计算',
      },
      { key: 'value', label: '值', type: 'textarea', required: true, placeholder: '如 count+1 或 你好 {userId}', hint: '表达式模式支持 + - * / % 与 {变量}、比较、三元' },
    ],
  },
  {
    id: 'sys.var_out',
    label: '读取变量',
    category: '变量与日志',
    kind: 'action',
    description: '将变量内容输出到执行日志（用于调试与留痕）',
    color: '#faad14',
    params: [
      { key: 'content', label: '读取内容', type: 'textarea', required: true, placeholder: '如 当前次数 {i}，结果 {lastResult}', hint: '支持 {变量} 引用，执行时输出到日志' },
    ],
  },
  {
    id: 'sys.log',
    label: '日志输出',
    category: '变量与日志',
    kind: 'action',
    description: '向执行日志输出一条记录',
    color: '#8c8c8c',
    params: [
      {
        key: 'level', label: '级别', type: 'select', default: 'info', options: [
          { label: '信息', value: 'info' }, { label: '警告', value: 'warn' }, { label: '错误', value: 'error' },
        ],
      },
      { key: 'content', label: '内容', type: 'textarea', required: true, placeholder: '支持 {变量} 引用' },
    ],
  },
  {
    id: 'sys.comment',
    label: '注释',
    category: '变量与日志',
    kind: 'action',
    description: '仅作说明注释，不执行任何操作',
    color: '#bfbfbf',
    params: [
      { key: 'text', label: '注释内容', type: 'textarea', placeholder: '写下这段流程的说明' },
    ],
  },
]

// 注入返回字段说明（发送/管理类磁贴无返回数据时标记为空数组，界面显示「无返回数据」）
export const TILES: TileDef[] = [
  ...onebotTiles.map((t) => ({ ...t, returns: RETURNS[t.id] ?? [] })),
  ...systemTiles,
  ...toolTiles,
]

export const TILE_MAP: Record<string, TileDef> = Object.fromEntries(TILES.map((t) => [t.id, t]))

// 按分类分组（用于磁贴库展示）
export interface TileCategory { key: string, label: string, kind: 'onebot' | 'system', tiles: TileDef[] }

export const ONEBOT_CATEGORIES: TileCategory[] = [
  [CAT_MSG, '消息操作', '#4f7cff', ['ob.send_private_msg', 'ob.send_group_msg', 'ob.send_msg', 'ob.delete_msg', 'ob.get_msg', 'ob.get_forward_msg', 'ob.send_group_forward_msg', 'ob.send_group_sign']],
  [CAT_GROUP, '群聊操作', '#ff7a45', ['ob.set_group_kick', 'ob.set_group_ban', 'ob.set_group_anonymous_ban', 'ob.set_group_whole_ban', 'ob.set_group_admin', 'ob.set_group_anonymous', 'ob.set_group_card', 'ob.set_group_name', 'ob.set_group_special_title', 'ob.set_group_leave', 'ob.set_group_portrait', 'ob.set_essence_msg', 'ob.delete_essence_msg']],
  [CAT_FRIEND, '好友与请求', '#b37feb', ['ob.send_like', 'ob.set_friend_add_request', 'ob.set_group_add_request']],
  [CAT_QUERY, '信息查询', '#36cfc9', ['ob.get_login_info', 'ob.get_stranger_info', 'ob.get_friend_list', 'ob.get_group_info', 'ob.get_group_list', 'ob.get_group_member_info', 'ob.get_group_member_list', 'ob.get_group_honor_info', 'ob.get_group_msg_history', 'ob.get_cookies', 'ob.get_csrf_token', 'ob.get_credentials']],
  [CAT_FILE, '文件媒体', '#9254de', ['ob.get_record', 'ob.get_image', 'ob.ocr_image', 'ob.get_group_file_system_info', 'ob.get_group_root_files', 'ob.get_group_files_by_folder', 'ob.upload_group_file', 'ob.can_send_image', 'ob.can_send_record']],
  [CAT_SYS, '系统维护', '#5cdbd3', ['ob.get_status', 'ob.get_version_info', 'ob.clean_cache']],
].map(([label, _sub, color, ids]) => {
  const key = label as string
  const tiles = (ids as string[]).map((id) => TILE_MAP[id]).filter(Boolean)
  return { key, label: key, kind: 'onebot' as const, tiles, color } as any
})

export const SYSTEM_CATEGORIES: TileCategory[] = [
  { key: 'flow', label: '流程控制', kind: 'system', tiles: ['sys.if', 'sys.loop_count', 'sys.loop_while', 'sys.wait', 'sys.break', 'sys.continue'].map((id) => TILE_MAP[id]) },
  { key: 'varlog', label: '变量与日志', kind: 'system', tiles: ['sys.var_set', 'sys.var_out', 'sys.log', 'sys.comment'].map((id) => TILE_MAP[id]) },
]

// 磁贴参数默认值
export function defaultParams(tile: TileDef): Record<string, any> {
  const out: Record<string, any> = {}
  for (const p of tile.params) {
    if (p.default !== undefined) out[p.key] = p.default
  }
  return out
}

// 条件规则比较运算（条件区子磁贴的补充参数选项）
export const COMPARE_OPS: { value: string, label: string }[] = [
  { value: '==', label: '== 等于' },
  { value: '!=', label: '!= 不等于' },
  { value: '>', label: '> 大于' },
  { value: '>=', label: '>= 大于等于' },
  { value: '<', label: '< 小于' },
  { value: '<=', label: '<= 小于等于' },
  { value: 'contains', label: '包含' },
  { value: 'notContains', label: '不包含' },
  { value: 'isEmpty', label: '为空' },
  { value: 'notEmpty', label: '不为空' },
]

// 需要填写对比值的操作符（为空/不为空 除外）
export const OP_NEEDS_VALUE = new Set(COMPARE_OPS.map((o) => o.value).filter((v) => v !== 'isEmpty' && v !== 'notEmpty'))