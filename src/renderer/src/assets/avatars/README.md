# 内置联系人插画头像

2026-11-24：用户确认插画方案后，以内置 image_gen 工具逐张生成 14 个独立头像；参考已确认的 `temp/avatar-design/contact-avatars-preview.png`。不通过模型 API，也不使用网络图片。

应用资源是 256×256 PNG，合计约 1.18 MB。生成原图为 1254×1254，保留在 `temp/avatar-design/originals/` 和工具输出目录。仅做等比缩小用于打包，未改变构图。参考图、原图及验收截图为本地临时文件，不随应用打包。下列提示词描述保留用于后续同风格扩展。

## 共同生成要求

Create ONE production avatar matching the approved reference board illustration style. Square 1:1 image, head-and-shoulders portrait, frontal or subtle three-quarter view, centered large head, eyes about 42% from top, shoulders at bottom. Hair and hat fully within 8% top/side safe margin, recognizable at 32px. Full-bleed uniform pastel background, no outer white area or circular boundary. Refined flat vector-like illustration with soft minimal shading matching reference, friendly mature professional companion, not emoji. No text, letters, labels, UI, grid, frames, sparkles, tiny props or other characters. Single final avatar only.

丑鱼使用相同画风的完整鱼形，保留尾巴与鱼鳍，四周约 12% 安全留白，淡青背景；不使用人物头肩构图。

## 角色提示词

- `fish.png`: the exact friendly teal fish mascot from the upper-left circle, preserving its recognizable silhouette, eyes, fins and restrained illustrated shading.
- `designer.png`: creative female designer: short dark asymmetrical bob, small silver earrings, plum turtleneck, pale mauve background.
- `zhou.png`: middle-aged male developer: wavy salt-and-pepper hair, dark rectangular glasses, muted blue shirt.
- `mei.png`: female product manager: dark high ponytail, sage collared shirt, bright confident smile.
- `lin.png`: gentle mature male counselor: soft swept salt-and-pepper hair, sage cardigan and cream shirt.
- `bai.png`: adult female health adviser: jaw-length side-parted dark bob, white coat over muted teal blouse.
- `zheng.png`: adult female lawyer: chin-length dark bob, thin rectangular glasses, charcoal blazer and ivory shirt.
- `emma.png`: English tutor: auburn shoulder-length waves, small earrings, dusty rose top.
- `bi.png`: male writer: medium wavy dark hair, gentle witty smile, muted ochre collared shirt.
- `qian.png`: middle-aged male finance adviser: side-parted dark hair, round glasses, navy cardigan.
- `yuanfang.png`: male traveler: short textured black hair, teal outdoor shirt over cream tshirt.
- `chuan.png`: middle-aged male chef: broad rounded face, short black hair, small white chef cap, white jacket.
- `yan.png`: male interviewer: neat short black hair, angular face, straight eyebrows, charcoal shirt.
- `buddy.png`: young adult female study coach: short dark pixie hair, round amber glasses, sage hoodie.

映射与选择标识见 `components/CharacterAvatar/builtinAvatars.ts`。用户进一步要求移除旧头像：界面仅提供插画选择，不再提供 emoji/文字输入或快选。预设按身份匹配；旧自定义联系人按稳定 ID 分配人物插画，改名不变。显式图片选择使用长度不超过 8 的短标识，优先于默认映射；保存表单时写入实际预览的图片标识。历史字段仅用于兼容读取，不删除联系人或历史消息。图片加载失败显示姓名首个文字/数字，没有可用文字则显示问号，不再回退旧 emoji。
