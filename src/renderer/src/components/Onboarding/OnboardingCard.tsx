import './OnboardingCard.css'

interface OnboardingCardProps {
  onConfigure: () => void
}

export default function OnboardingCard({ onConfigure }: OnboardingCardProps) {
  return (
    <section className="onboarding-card" aria-labelledby="onboarding-title">
      <div className="onboarding-mark" aria-hidden="true">
        <svg width="28" height="28" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 12h16v13H8zM11 12V8a5 5 0 0110 0v4M12 18h8M16 15v6"/>
        </svg>
      </div>
      <div className="onboarding-copy">
        <span className="onboarding-kicker">需要配置</span>
        <h2 id="onboarding-title">连接你的 AI 服务</h2>
        <p>ChouYu 不预设任何 AI 服务。必须配置 Provider、Base URL、API Key 和默认模型后才能开始对话。</p>
      </div>
      <ol className="onboarding-steps" aria-label="配置步骤">
        <li><span>1</span>填写服务</li>
        <li><span>2</span>测试连接</li>
        <li><span>3</span>选择模型</li>
      </ol>
      <div className="onboarding-actions">
        <button type="button" className="onboarding-primary" onClick={onConfigure}>
          打开 AI 设置
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 8h10M9 4l4 4-4 4"/>
          </svg>
        </button>
      </div>
    </section>
  )
}
