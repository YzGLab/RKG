import { useState } from 'react'
import RocSimulator from './RocSimulator'
import KmSimulator from './KmSimulator'

export default function App() {
  const [tab, setTab] = useState<'roc' | 'km'>('roc')

  return (
    <div className="app">
      <header className="header">
        <h1 className="title">医学曲线模拟器</h1>
        <nav className="tabs">
          <button className={`tab ${tab === 'roc' ? 'active' : ''}`} onClick={() => setTab('roc')}>
            ROC 曲线
          </button>
          <button className={`tab ${tab === 'km' ? 'active' : ''}`} onClick={() => setTab('km')}>
            KM 生存曲线
          </button>
        </nav>
      </header>
      <main className="main">
        {tab === 'roc' ? <RocSimulator /> : <KmSimulator />}
      </main>
    </div>
  )
}
