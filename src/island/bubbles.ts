/**
 * 岛民对白：每隔一阵，屏幕上看得见的某个岛民头顶冒出一句话。台词跟今天的内容挂钩，能点的会带链接。
 * 例：邮差送来今天的日报；码头钓鱼的周伯随机「钓」出一篇旧文章。
 */
import * as THREE from 'three';
import type { IslandData } from '@/island/content';
import type { Actor, SayKey } from '@/island/residents';
import { FEATURED, ISLAND_FILM, RECENT_VIDEOS, videoUrl } from '@/island/videos';

/** 多久冒一句、一句停留多久（秒）；离镜头多远就不说了（看不清）。 */
const EVERY = 7;
const STAY = 6;
const MAX_DIST = 95;
/** 气泡在头顶上方多高（米）。 */
const LIFT = 2.1;

interface Line { text: string; url?: string; external?: boolean }
const pick = <T,>(list: T[]) => list[Math.floor(Math.random() * list.length)];

function linesFor(say: SayKey, d: IslandData, topic?: string): Line[] {
  const stall = d.topics.find((t) => t.slug === topic) ?? pick(d.topics.filter((t) => t.latest));
  const latest = d.posts[0], pencil = RECENT_VIDEOS.filter((v) => v.series === 'pencil'), vid = RECENT_VIDEOS[0];
  const old = d.archive.length ? pick(d.archive) : null;
  const L: Record<SayKey, Line[]> = {
    mail: d.daily ? [{ text: `日报第 ${d.daily.issueNo} 期送到啦！`, url: d.daily.url }, { text: `今天 ${d.daily.count} 条信号，头条：${d.daily.headlines[0] ?? ''}`, url: d.daily.url }] : [],
    keeper: latest ? [{ text: `灯塔今晚照着岛刊社——新文章：${latest.title}`, url: latest.url }, { text: '守灯塔这么多年，最亮的还是新文章。' }] : [],
    jog: [{ text: '往返 1 公里，再来一趟！' }, { text: '跑完去岛刊社坐坐，听说今天有新稿。', url: latest?.url }],
    fish: old ? [{ text: `钓上来一篇 ${old.date.slice(0, 7)} 的旧文：${old.title}`, url: old.url }] : [],
    reader: latest ? [{ text: `在读《${latest.title}》，写得挺实在。`, url: latest.url }] : [],
    stroll: [{ text: '从灯塔那边看海，风景最好。' }, { text: '岛刊社的专题页，按话题看文章挺方便。', url: '/topics/' }],
    shipyard: [{ text: `船坞那艘「${FEATURED[1]?.title.split('：')[0] ?? '新船'}」，听说快下水了。`, url: '/videos/' }],
    climb: [{ text: '岛主小屋就在台阶上面，听说岛主天天写到半夜。', url: '/about/' }],
    kid: [{ text: '我长大要当灯塔看守！' }, { text: '晚上会有鲸鱼游过来喷水哦！' }],
    cinema: vid ? [{ text: `B 站刚出的新片：${vid.title}`, url: videoUrl(vid.bvid), external: true }] : [],
    painter: pencil.length ? [{ text: `这一集画的是：${pick(pencil).title.split('？')[0]}？`, url: videoUrl(pencil[0].bvid), external: true }] : [],
    scout: [{ text: '这座小岛还没名字，你有好主意吗？' }],
    hiker: [{ text: '山顶瞭望亭能看到整片群岛！' }, { text: '石阶一共一百多级，慢慢爬。' }],
    walkdog: [{ text: '（牵着钱钱，慢慢遛弯）' }, { text: '（在兰兰超市门口歇一会儿）' }],
    grill: [{ text: '烤串好了，趁热！' }, { text: '（翻串，滋啦作响）' }],
    stock: [{ text: '（往筐里码新到的水果）' }, { text: '兰兰超市，晚上九点半关门。' }],
    lift: [{ text: '再来一组！' }, { text: '（举铁，呼——）' }],
    paint: [{ text: `「${FEATURED[1]?.title.split('：')[0] ?? '新船'}」这艘船，漆快刷完了。`, url: '/videos/' }, { text: '（给新船刷漆）' }],
    pottery: [{ text: '（捏一只新陶罐）' }, { text: '彤彤手工坊，欢迎来捏泥巴。' }],
    guard: [{ text: '下水前先热身哦！' }, { text: '（盯着海面）' }],
    diner: [{ text: '再来十串！' }, { text: '（吃串，看海）' }],
    vendor: stall ? [{ text: `「${stall.name}」摊，${stall.count} 篇。新到一篇：${stall.latest?.title ?? '还在路上'}`, url: stall.latest?.url ?? stall.url }, { text: `来看看「${stall.name}」，都是现做的！`, url: stall.url }] : [],
    market: [{ text: '夜市一个摊一个话题，逛到哪儿看到哪儿。', url: '/topics/' }, { text: '（逛夜市，慢慢走）' }],
    net: [{ text: '（补渔网）' }, { text: '今早出海，收成不错。' }],
    unload: [{ text: '（往岸上搬鱼筐）' }, { text: '新鲜的，晚上夜市就有！' }],
    // 银幕上循环放的是小岛介绍片（cinema-screen.ts），观众说的要对得上
    audience: [{ text: `银幕上在放：${ISLAND_FILM.title}`, url: videoUrl(ISLAND_FILM.bvid), external: true }],
  };
  return L[say];
}

export function createBubbles(host: HTMLElement, actors: Actor[], data: IslandData) {
  const el = document.createElement('a');
  el.className = 'isl-bubble';
  el.hidden = true;
  host.appendChild(el);
  let current: Actor | null = null, shownAt = -Infinity, nextAt = 3;
  const v = new THREE.Vector3();

  function onScreen(a: Actor, camera: THREE.Camera) {
    if (!a.root.visible) return false; // 下班不在岛上的人不说话
    v.copy(a.root.position).setY(a.root.position.y + LIFT);
    if (camera.position.distanceTo(v) > MAX_DIST) return false;
    v.project(camera);
    return v.z < 1 && Math.abs(v.x) < 0.85 && v.y < 0.8 && v.y > -0.7;
  }
  function show(a: Actor, t: number) {
    const lines = linesFor(a.say, data, a.topic).filter((l) => l.text);
    if (!lines.length) return;
    const line = pick(lines);
    el.replaceChildren(Object.assign(document.createElement('b'), { textContent: a.name }), document.createTextNode(line.text));
    if (line.url) {
      el.href = line.url;
      el.target = line.external ? '_blank' : '';
      el.rel = line.external ? 'noopener noreferrer' : '';
      el.classList.add('has-link');
    } else {
      el.removeAttribute('href');
      el.classList.remove('has-link');
    }
    current = a;
    shownAt = t;
    el.hidden = false;
  }
  return {
    update(t: number, camera: THREE.Camera, w: number, h: number) {
      if (current && (t - shownAt > STAY || !onScreen(current, camera))) { el.hidden = true; current = null; nextAt = t + EVERY - STAY; }
      if (!current && t >= nextAt) {
        const visible = actors.filter((a) => onScreen(a, camera));
        if (visible.length) show(pick(visible), t);
        nextAt = t + EVERY;
      }
      if (!current) return;
      v.copy(current.root.position).setY(current.root.position.y + LIFT).project(camera);
      el.style.transform = `translate3d(${Math.round((v.x * 0.5 + 0.5) * w)}px, ${Math.round((-v.y * 0.5 + 0.5) * h)}px, 0) translate(-50%, -100%)`;
    },
  };
}
