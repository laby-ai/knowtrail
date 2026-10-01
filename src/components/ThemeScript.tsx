'use client';

export function ThemeScript() {
  const scriptContent = `(function(){try{var t=localStorage.getItem('theme');if(t==='light')document.documentElement.setAttribute('data-theme','light')}catch(e){}})()`;

  return (
    <script suppressHydrationWarning dangerouslySetInnerHTML={{ __html: scriptContent }} />
  );
}
