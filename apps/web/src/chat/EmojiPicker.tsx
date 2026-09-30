import { useState } from "react";

const GROUPS: { id: string; icon: string; emoji: string[] }[] = [
  {
    id: "Smileys",
    icon: "😀",
    emoji: "😀 😃 😄 😁 😆 😅 🤣 😂 🙂 🙃 😉 😊 😇 🥰 😍 🤩 😘 😗 😚 😋 😛 😜 🤪 😝 🤗 🤭 🤫 🤔 🤐 😐 😑 😶 😏 😒 🙄 😬 😮‍💨 😌 😔 😪 😴 😷 🤒 🤕 🤢 🤮 🥵 🥶 🥴 😵 🤯 🤠 🥳 😎 🤓 🧐 😕 😟 🙁 😮 😯 😲 😳 🥺 😦 😧 😨 😰 😥 😢 😭 😱 😖 😣 😞 😓 😩 😫 🥱 😤 😡 😠 🤬 😈 💀 💩 🤡 👻 👽 🤖".split(" "),
  },
  {
    id: "People",
    icon: "👋",
    emoji: "👋 🤚 🖐️ ✋ 🖖 👌 🤌 🤏 ✌️ 🤞 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ 👍 👎 ✊ 👊 🤛 🤜 👏 🙌 👐 🤲 🤝 🙏 ✍️ 💅 🤳 💪 🦾 🧠 👀 👁️ 👅 👄 🫶 🫡 🫠 🙋 🙆 🙅 🤷 🤦 💁 🙇 🧍 🏃 💃 🕺".split(" "),
  },
  {
    id: "Hearts",
    icon: "❤️",
    emoji: "❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 💟 ✨ ⭐ 🌟 💫 🔥 💥 💯 💢 💤 💦 💨 🎉 🎊 🎈 🎁".split(" "),
  },
  {
    id: "Nature",
    icon: "🌿",
    emoji: "🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🐨 🐯 🦁 🐮 🐷 🐸 🐵 🙈 🙉 🙊 🐔 🐧 🐦 🦆 🦉 🦄 🐝 🦋 🐌 🐢 🐍 🐙 🦀 🐠 🐬 🐳 🌵 🌲 🌴 🌱 🍀 🍁 🌸 🌹 🌻 🌞 🌙 ⭐ ⛅ 🌈 ⚡ ❄️ 🌊".split(" "),
  },
  {
    id: "Food",
    icon: "🍕",
    emoji: "🍏 🍎 🍐 🍊 🍋 🍌 🍉 🍇 🍓 🫐 🍒 🍑 🥭 🍍 🥥 🥝 🍅 🥑 🥦 🌽 🥕 🥔 🍞 🧀 🍳 🥓 🍔 🍟 🌭 🍕 🌮 🌯 🍣 🍜 🍝 🍦 🍩 🍪 🎂 🍫 🍿 ☕ 🍵 🍺 🍷 🥂 🥤".split(" "),
  },
  {
    id: "Things",
    icon: "🚀",
    emoji: "⚽ 🏀 🏈 ⚾ 🎾 🏐 🎱 🏓 🎮 🎯 🎲 🎸 🎹 🥁 🎧 🎤 🎬 📷 📱 💻 ⌨️ 🖥️ 💡 🔋 🔒 🔑 📌 📎 ✏️ 📚 📅 ✅ ❌ ⚠️ ❓ ❗ 🚗 ✈️ 🚀 🏠 ⏰ 💰 🎓 🏆".split(" "),
  },
];

export function EmojiPicker({ onPick }: { onPick: (emoji: string) => void }) {
  const [group, setGroup] = useState(0);
  const g = GROUPS[group]!;
  return (
    <div className="pop-in w-[19rem] rounded-2xl border border-line bg-s1 p-2 shadow-[var(--shadow)]">
      <div className="mb-1 flex gap-0.5 border-b border-line pb-1.5">
        {GROUPS.map((x, i) => (
          <button
            key={x.id}
            type="button"
            onClick={() => setGroup(i)}
            title={x.id}
            aria-label={x.id}
            className={`flex h-8 flex-1 items-center justify-center rounded-lg text-lg transition ${
              i === group ? "bg-s3" : "opacity-60 hover:bg-s2 hover:opacity-100"
            }`}
          >
            {x.icon}
          </button>
        ))}
      </div>
      <div className="grid h-52 grid-cols-8 content-start gap-0.5 overflow-y-auto pr-1">
        {g.emoji.map((e, i) => (
          <button
            key={`${e}${i}`}
            type="button"
            onClick={() => onPick(e)}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-xl transition hover:scale-125 hover:bg-s3"
          >
            {e}
          </button>
        ))}
      </div>
    </div>
  );
}
