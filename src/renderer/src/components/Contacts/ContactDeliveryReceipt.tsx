import { useState } from 'react'
import { receiptDeliveryRef } from '../../../../shared/contact-source-navigation'
import type { ContactCommunication } from '../../../../shared/contact-communication'
import { navigateContact } from './contactNavigation'
export default function ContactDeliveryReceipt({ communication }: { communication?: ContactCommunication }) {
  const [error, setError] = useState(''), ref = receiptDeliveryRef(communication)
  if (!ref) return null
  return <span><button type="button" data-delivery-receipt={JSON.stringify(ref)} onClick={() => { setError(''); void navigateContact({ kind: 'delivery', ref }).catch(e => setError(String(e))) }}>查看本轮成果 · 第 {ref.version} 版</button>{error && <span role="alert">{error}</span>}</span>
}
