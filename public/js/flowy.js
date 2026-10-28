// HostelFlow — Flowy, the help assistant in Settings → Help & support.
// The conversation stays in the page; each question is sent with it to
// /api/assistant (src/assistant.js), which answers from the app's guide.

let flowyChat = [];

function flowyBubble(role, content) {
  const el = document.createElement('div');
  el.className = `flowy-msg ${role}`;
  el.textContent = content; // plain text only, shown with its line breaks
  $('fl-log').append(el);
  $('fl-log').scrollTop = $('fl-log').scrollHeight;
  return el;
}

function flowyGreet() {
  if ($('fl-log').childElementCount) return;
  flowyBubble('assistant', t("Hi! I'm Flowy 👋 Ask me anything about setting up or using HostelFlow — for example how to connect Alloggiati Web or invite your team."));
}
$('sec-support').addEventListener('toggle', () => { if ($('sec-support').open) flowyGreet(); });

bindForm('form-flowy', 'fl-err', async () => {
  const question = $('fl-text').value.trim();
  if (!question || !state.property) return;
  flowyBubble('user', question);
  $('fl-text').value = '';
  const thinking = flowyBubble('assistant thinking', t('Flowy is thinking…'));
  try {
    const r = await api('POST', '/api/assistant', {
      propertyId: state.property.id, lang: LANG,
      messages: [...flowyChat, { role: 'user', content: question }],
    });
    flowyChat.push({ role: 'user', content: question }, { role: 'assistant', content: r.reply });
    flowyChat = flowyChat.slice(-12);
    thinking.className = 'flowy-msg assistant';
    thinking.textContent = r.reply;
    $('fl-log').scrollTop = $('fl-log').scrollHeight;
  } catch (err) {
    thinking.remove();
    $('fl-text').value = question; // nothing lost: ask again
    throw err;
  }
});
