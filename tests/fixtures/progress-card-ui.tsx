import React from 'react'
import { createRoot } from 'react-dom/client'
import AgentProgressCard from '../../src/renderer/src/components/ChatPanel/AgentProgressCard'
import { legacyProgressUpdate } from '../../src/shared/agent-progress'
import '../../src/renderer/src/styles/index.css'
import '../../src/renderer/src/styles/tokens.css'
import '../../src/renderer/src/components/ChatPanel/ChatPanel.css'
import '../../src/renderer/src/components/ChatPanel/ContactWorkToolbar.css'

const legacy = legacyProgressUpdate('「持续生产小团队可验证的AI产品idea」有新的判断。\n\n当前判断：本轮交付idea #23 部署回滚决策助手，首次覆盖运维自动化中的部署故障响应方向，与此前22个idea差异化清晰\n\n变化原因：第23轮：继续产出第23个AI产品idea，探索运维自动化方向\n\n下一步：第24轮：产出第24个AI产品idea并完成第三批复盘，筛选最值得验证的3个方向。')!
createRoot(document.getElementById('root')!).render(<main style={{ maxWidth: 660, margin: 'auto', padding: 16 }}>
  {[{ ...legacy, title: 'Idea #23 · 部署回滚决策助手', outcome: 'delivered' as const }, legacy].map((update, index) => <div className="message message-assistant" key={index}>
    <div className="message-body"><span className="message-sender">阿想 · Idea 实验员{index ? ' · 历史消息' : ''}</span>
      <div className="message-bubble"><AgentProgressCard update={update} /></div>
      <div className="agent-message-links"><button>查看任务</button><button>查看本轮成果</button></div>
    </div>
  </div>)}
</main>)
