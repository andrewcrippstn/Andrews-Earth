#!/usr/bin/env python3
"""Builds andrews-earth-single.html: index.html with assets/ae-images.js and the three dino-egg/*.js files
embedded, so the whole app is ONE file (Leaflet / Font Awesome / Google Fonts still come from their CDNs).
Run from anywhere:  python3 tools/build-single.py"""
import pathlib,re
root=pathlib.Path(__file__).resolve().parent.parent
rd=lambda p:(root/p).read_text(encoding='utf-8')
def safe(t):                      # keep the embedded text from ending / confusing its <script> element
    return t.replace('</script','<\\/script').replace('<!--','<\\!--')
html=rd('index.html')

# 1. AE-IMAGES loader -> data inline, icons applied immediately
a=html.index('<script data-ae-images>');b=html.index('</script>',a)+len('</script>')
inline_imgs='<script data-ae-images>'+rd('assets/ae-images.js').replace('</script','<\\/script')+'''
(function(){var I=window.AE_IMAGES;window.__aeImagesReady=Promise.resolve();if(!I)return;
(I.icons||[]).forEach(function(i){var l=document.createElement('link');l.rel=i.rel;if(i.type)l.type=i.type;if(i.sizes)l.sizes=i.sizes;l.href=i.href;document.head.appendChild(l);});
function brand(){var el=document.querySelector('.brand-mark');if(el&&I.brandMark&&!el.querySelector('img')){var im=document.createElement('img');im.src=I.brandMark;im.alt='';im.width=30;im.height=30;el.appendChild(im);}}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',brand);else brand();})();</script>'''
html=html[:a]+inline_imgs+html[b:]

# 2. Dino egg loader -> run the embedded copies instead of fetching dino-egg/*.js
old_start=html.index("['dino-sprites.js', 'dino-egg.js', 'dino-ae-ui.js'].forEach((f) => {")
old_end=html.index("});",html.index("document.head.appendChild(s);",old_start))+3
new_loader=("['dino-sprites.js', 'dino-egg.js', 'dino-ae-ui.js'].forEach((f) => {\n"
"                    const src = document.querySelector('script[data-embedded=\"' + f + '\"]'); if (!src) return;\n"
"                    const s = document.createElement('script'); s.textContent = src.textContent;   // single-file build: run the embedded copy, in order\n"
"                    document.head.appendChild(s);\n"
"                });")
html=html[:old_start]+new_loader+html[old_end:]

# 3. embedded egg sources (inert text/plain blocks) just before </body>
blocks=''.join('<script type="text/plain" data-embedded="%s">\n%s\n</script>\n'%(f,safe(rd('dino-egg/'+f))) for f in ['dino-sprites.js','dino-egg.js','dino-ae-ui.js'])
# they must exist before the main script runs the loader, so put them right after <body>
i=html.index('<body>')+len('<body>')
html=html[:i]+'\n'+blocks+html[i:]
(root/'andrews-earth-single.html').write_text(html,encoding='utf-8')
print('wrote andrews-earth-single.html',len(html)//1024,'KB')
