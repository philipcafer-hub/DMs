
async function api(path, opts={}){
  const res = await fetch(path, { credentials:'include', headers:{'Content-Type':'application/json'}, ...opts });
  if(!res.ok) throw new Error((await res.json()).error || 'Request failed');
  return await res.json();
}

const authSection = document.getElementById('authSection');
const chatSection = document.getElementById('chatSection');
const meArea = document.getElementById('meArea');
const meName = document.getElementById('meName');
const meAvatar = document.getElementById('meAvatar');

let me = null;
let socket = null;
let currentPeer = null;
let typingTimeout = null;

function fmt(d){
  const dt = new Date(d);
  return dt.toLocaleString();
}

function setLoggedIn(user){
  me = user;
  authSection.classList.add('hidden');
  chatSection.classList.remove('hidden');
  meArea.classList.remove('hidden');
  meName.textContent = `${user.display_name} (@${user.username})`;
  meAvatar.src = user.avatar_url || 'https://api.dicebear.com/9.x/identicon/svg?seed=' + encodeURIComponent(user.username);
  document.getElementById('profile_display').value = user.display_name || '';
  document.getElementById('profile_avatar').value = user.avatar_url || '';
  document.getElementById('profile_bio').value = user.bio || '';
  connectSocket();
  loadUsers();
}

function setLoggedOut(){
  me = null;
  authSection.classList.remove('hidden');
  chatSection.classList.add('hidden');
  meArea.classList.add('hidden');
  if(socket){ socket.close(); socket = null; }
}

async function checkMe(){
  try{
    const { user } = await api('/api/me');
    setLoggedIn(user);
  }catch(_e){
    setLoggedOut();
  }
}

async function signup(){
  const username = document.getElementById('su_username').value.trim();
  const displayName = document.getElementById('su_display').value.trim();
  const password = document.getElementById('su_password').value;
  const { user } = await api('/api/signup', { method:'POST', body: JSON.stringify({ username, displayName, password }) });
  setLoggedIn(user);
}

async function login(){
  const username = document.getElementById('li_username').value.trim();
  const password = document.getElementById('li_password').value;
  const { user } = await api('/api/login', { method:'POST', body: JSON.stringify({ username, password }) });
  setLoggedIn(user);
}

async function logout(){
  await api('/api/logout', { method:'POST' });
  setLoggedOut();
}

document.getElementById('signupBtn').addEventListener('click', signup);
document.getElementById('loginBtn').addEventListener('click', login);
document.getElementById('logoutBtn').addEventListener('click', logout);

async function saveProfile(){
  const displayName = document.getElementById('profile_display').value.trim();
  const avatarUrl = document.getElementById('profile_avatar').value.trim();
  const bio = document.getElementById('profile_bio').value;
  const { user } = await api('/api/me', { method:'PUT', body: JSON.stringify({ displayName, bio, avatarUrl }) });
  setLoggedIn(user);
}
document.getElementById('saveProfileBtn').addEventListener('click', saveProfile);

async function loadUsers(){
  const list = document.getElementById('userList');
  list.innerHTML = '';
  const { users } = await api('/api/users');
  users.forEach(u => {
    const li = document.createElement('li');
    li.dataset.id = u.id;
    li.innerHTML = `<img class="avatar" src="${u.avatar_url || 'https://api.dicebear.com/9.x/identicon/svg?seed='+encodeURIComponent(u.username)}" alt=""/> <span>${u.display_name} (@${u.username})</span>`;
    li.addEventListener('click', () => selectPeer(u));
    list.appendChild(li);
  });
}

function selectPeer(u){
  currentPeer = u;
  document.querySelectorAll('#userList li').forEach(li=>li.classList.toggle('active', Number(li.dataset.id)===u.id));
  document.getElementById('chatHeader').textContent = `Chat with ${u.display_name} (@${u.username})`;
  document.getElementById('composer').classList.remove('hidden');
  document.getElementById('messages').innerHTML = '';
  if(socket){
    socket.emit('dm:leave', u.id); // leave previous room if any
    socket.emit('dm:join', u.id);
  }
  loadMessages(u.id);
}

async function loadMessages(otherId){
  const { messages } = await api(`/api/messages/${otherId}`);
  const box = document.getElementById('messages');
  box.innerHTML = '';
  messages.forEach(addMessageBubble);
  box.scrollTop = box.scrollHeight;
}

function addMessageBubble(m){
  const div = document.createElement('div');
  div.className = 'message ' + (m.sender_id === me.id ? 'me' : 'them');
  div.innerHTML = `<div>${escapeHtml(m.body)}</div><div class="meta">${fmt(m.created_at)}</div>`;
  document.getElementById('messages').appendChild(div);
}

function connectSocket(){
  socket = io({ withCredentials: true });
  socket.on('connect', () => {
    if(currentPeer) socket.emit('dm:join', currentPeer.id);
  });
  socket.on('message:new', (m) => {
    if(!currentPeer) return;
    const pair = [m.sender_id, m.receiver_id];
    if(pair.includes(me.id) && pair.includes(currentPeer.id)){
      addMessageBubble(m);
      const box = document.getElementById('messages');
      box.scrollTop = box.scrollHeight;
    }
  });
  socket.on('typing', ({ from, isTyping }) => {
    if(currentPeer && currentPeer.id === from){
      document.getElementById('typingHint').textContent = isTyping ? `${currentPeer.display_name} is typing...` : '';
      if(!isTyping) return;
      clearTimeout(typingTimeout);
      typingTimeout = setTimeout(()=>{
        document.getElementById('typingHint').textContent='';
      }, 1200);
    }
  });
}

function sendMessage(){
  const input = document.getElementById('messageInput');
  const body = input.value;
  if(!currentPeer || !body.trim()) return;
  socket.emit('message:send', { to: currentPeer.id, body }, (resp) => {
    if(resp && resp.ok){
      input.value = '';
    }
  });
}

document.getElementById('sendBtn').addEventListener('click', sendMessage);
document.getElementById('messageInput').addEventListener('keydown', (e)=>{
  if(e.key === 'Enter' && !e.shiftKey){
    e.preventDefault();
    sendMessage();
  }else{
    if(currentPeer){
      socket.emit('typing', { to: currentPeer.id, isTyping: true });
    }
  }
});
document.getElementById('messageInput').addEventListener('blur', ()=>{
  if(currentPeer) socket.emit('typing', { to: currentPeer.id, isTyping: false });
});

function escapeHtml(s){
  return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
}

checkMe();

