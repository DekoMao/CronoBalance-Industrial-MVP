module.exports = { ...{
      darkMode: 'class',
      theme: {
        extend: {
          fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'] },
          colors: {
            obsidian: {
              bg: '#0B121C',
              card: '#131E2D',
              inner: '#1A2738',
              slot: '#0F1824',
              border: '#243449'
            },
            navy: {
              header: '#103653',
              light: '#1B4F78'
            },
            gold: {
              DEFAULT: '#F4BA25',
              dim: '#B88918'
            },
            cyanbar: {
              DEFAULT: '#1E90B8',
              light: '#38BDF8'
            }
          }
        }
      }
    }, content: ['./index.html','./src/workspace/**/*.{js,ts,tsx}'] };
