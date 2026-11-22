export const THEME_KEY = 'pharmtrack.theme';

/** Inline script that sets data-theme before first paint, so a saved theme does not flash. */
export const themeScript = `try{var t=localStorage.getItem('${THEME_KEY}');if(t==='dark'||t==='light')document.documentElement.dataset.theme=t}catch(e){}`;
