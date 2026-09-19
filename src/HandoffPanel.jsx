import React,{useEffect,useMemo,useRef,useState} from 'react';
import qrcode from 'qrcode-generator';
import {Modal} from './TaskPanels.jsx';
import {fetchHandoffInfo, pollHandoff, releaseHandoff, startHandoff} from './handoffClient.js';
import './handoff.css';

const POLL_INTERVAL = 1000;

function qrSvg(url) {
  const code = qrcode(0, 'M');
  code.addData(url);
  code.make();
  return code.createSvgTag({cellSize: 6, margin: 2, scalable: true});
}

// 「发送到手机」弹窗。曲目包在这里上传到本机服务，二维码只带地址：
// 原谱图片约 1.6 MB，塞不进二维码，手机必须在同一个 Wi-Fi 下把包拉走。
export function HandoffPanel({song, document, baseTempo, onClose}) {
  const [state, setState] = useState({phase: 'preparing'});
  const token = useRef(null);
  useEffect(() => () => { if (token.current) releaseHandoff(token.current); }, []);
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const info = await fetchHandoffInfo();
        if (!live) return;
        if (!info.preferred) {
          setState({phase: 'no-address'});
          return;
        }
        if (!info.lanBound) {
          setState({phase: 'loopback', address: info.preferred, port: info.port});
          return;
        }
        const session = await startHandoff({song, document, images: song.images, baseTempo});
        if (!live) {
          releaseHandoff(session.token);
          return;
        }
        token.current = session.token;
        setState({phase: 'waiting', session, served: 0, total: session.manifest.images.length});
      } catch (error) {
        if (live) setState({phase: 'error', message: error.message});
      }
    })();
    return () => { live = false; };
  }, [song, document, baseTempo]);

  useEffect(() => {
    if (state.phase !== 'waiting') return;
    const timer = setInterval(async () => {
      const status = await pollHandoff(state.session.token);
      if (!status) return;
      setState((current) =>
        current.phase === 'waiting'
          ? {phase: status.completed ? 'done' : 'waiting', session: current.session, served: status.imagesServed, total: status.imagesTotal}
          : current,
      );
    }, POLL_INTERVAL);
    return () => clearInterval(timer);
  }, [state.phase, state.session?.token]);

  const url = state.session?.url || null;
  const svg = useMemo(() => (url ? qrSvg(url) : ''), [url]);

  return <Modal title="发送到手机" onClose={onClose} className="handoff-dialog">
    {state.phase === 'preparing' && <p className="handoff-status" role="status">正在准备曲目…</p>}
    {state.phase === 'no-address' && <div className="handoff-note" role="status">
      <p>没有检测到局域网地址。</p>
      <p>请确认电脑已连接 Wi‑Fi 或网线，然后重新打开这个面板。</p>
    </div>}
    {state.phase === 'loopback' && <div className="handoff-note" role="status">
      <p>当前程序只监听本机（<code>{state.address}:{state.port}</code>），手机连不上。</p>
      <p>请重新启动乐北斗后再试。</p>
    </div>}
    {state.phase === 'error' && <div className="handoff-note" role="alert">
      <p>{state.message}</p>
    </div>}
    {(state.phase === 'waiting' || state.phase === 'done') && <div className="handoff-body">
      <div className="handoff-qr" dangerouslySetInnerHTML={{__html: svg}} aria-label="手机扫码接收曲目"/>
      <div className="handoff-side">
        <p className="handoff-title">{state.session.manifest.song.title}</p>
        <p className="handoff-address"><code>{url}</code></p>
        <p className="handoff-progress" role="status">
          {state.phase === 'done'
            ? '已发送到手机 ✓'
            : state.served > 0
              ? `接收中… ${state.served} / ${state.total} 页`
              : '等待手机扫描…'}
        </p>
      </div>
    </div>}
    <footer className="task-footer">
      <span className="handoff-hint">手机需与电脑在同一个 Wi‑Fi</span>
      <button className="secondary" onClick={onClose}>关闭</button>
    </footer>
  </Modal>;
}
