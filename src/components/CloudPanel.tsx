import { useState } from 'react'
import type { FormEvent } from 'react'
import type { useCloud } from '../app/cloud.ts'
import { knownLevel } from '../app/storage.ts'

export default function CloudPanel({ cloud }: { cloud: ReturnType<typeof useCloud> }) {
  const [restore, setRestore] = useState(false)
  const [username, setUsername] = useState('')
  const [recovery, setRecovery] = useState('')
  const [shown, setShown] = useState('')
  const [message, setMessage] = useState('')
  const [pending, setPending] = useState(false)

  async function run(action: () => Promise<void>) {
    if (pending) return
    setMessage('')
    setPending(true)
    try { await action() }
    catch (error) { setMessage(error instanceof Error ? error.message : '操作未完成，请重试。') }
    finally { setPending(false) }
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void run(async () => {
      const code = await cloud.signIn(username, restore ? recovery : undefined)
      setShown(code ?? '')
      setRecovery('')
    })
  }

  if (cloud.cloudStatus !== 'available' && !cloud.profile) {
    return <section className="cloud-panel"><h3>云档案</h3>
      <p className="muted">{{ checking: '正在检查云服务…', unconfigured: '云服务未配置，草稿保存在此设备。', offline: '云服务暂时无法连接。' }[cloud.cloudStatus]}</p>
    </section>
  }

  return <section className="cloud-panel" aria-label="云档案">
    <h3>云档案</h3>
    {cloud.profile ? <>
      <p>{cloud.profile.username} · {cloud.syncStatus}</p>
      <div className="modal-actions">
        <button className="plain" disabled={pending} onClick={() => void run(() => cloud.syncAll())}>同步本地草稿</button>
        <button className="plain" disabled={pending} onClick={() => void run(async () => setShown(await cloud.rotate()))}>更换恢复码</button>
        <button className="plain" disabled={pending} onClick={() => void run(async () => { await cloud.signOut(); setShown('') })}>退出云档案</button>
      </div>
    </> : <form onSubmit={submit} className="cloud-form">
      <label>用户名<input required autoComplete="username" value={username} maxLength={48} onChange={event => setUsername(event.target.value)} /></label>
      {restore && <label>恢复码<input required type="password" autoComplete="current-password" value={recovery} maxLength={100} onChange={event => setRecovery(event.target.value)} /></label>}
      <div className="modal-actions">
        <button className="primary" disabled={pending}>{restore ? '恢复云档案' : '创建云档案'}</button>
        <button className="plain" type="button" disabled={pending} onClick={() => { setRestore(!restore); setMessage(''); setRecovery('') }}>
          {restore ? '创建新档案' : '使用恢复码'}
        </button>
      </div>
    </form>}
    {shown && <div className="recovery-code"><p>请保存这次显示的恢复码。跨设备登录需要用户名和恢复码。</p>
      <code>{shown}</code><button className="plain" onClick={() => void run(async () => {
        await navigator.clipboard.writeText(shown)
        setMessage('恢复码已复制。')
      })}>复制恢复码</button>
    </div>}
    {Object.entries(cloud.conflicts).map(([id]) => <div className="sync-conflict" key={id}>
      <p>{knownLevel(id)?.title ?? id}有两份草稿，请选择要继续使用的一份。</p>
      <div className="modal-actions"><button className="plain" onClick={() => cloud.resolve(id, true)}>采用本地草稿</button>
        <button className="plain" onClick={() => cloud.resolve(id, false)}>采用云端草稿</button></div>
    </div>)}
    {message && <p role="status">{message}</p>}
  </section>
}
