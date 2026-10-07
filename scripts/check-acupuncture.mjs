import {chromium,expect} from '@playwright/test';
import sharp from 'sharp';

const browser=await chromium.launch({executablePath:'C:/Users/ASUS/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe',headless:true,args:['--enable-unsafe-swiftshader','--use-angle=swiftshader']});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(180000);
 const errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error'&&!message.text().includes('Failed to load resource'))errors.push(message.text());});page.on('response',response=>{if(response.status()>=400&&response.url().includes('/assets/'))errors.push(`${response.status()} ${response.url()}`);});
 const response=await page.goto(process.env.VIEWER_URL||'http://127.0.0.1:4321/assets/index.html');if(!response?.ok())throw Error(`Viewer returned ${response?.status()}`);
 await expect(page.locator('#loading')).toBeHidden({timeout:180000});
 await page.locator('#acupuncture-menu summary').click();
 await expect(page.locator('#acupuncture-channels button')).toHaveCount(14);
 const panel=await page.locator('.acupuncture-content').boundingBox();if(!panel||panel.x<0||panel.x+panel.width>1440)throw Error('Acupuncture controls are outside the viewport');
 const canvas=page.locator('#canvas'),before=await canvas.screenshot();
 await page.locator('#acupuncture-points').click();await page.locator('#acupuncture-menu summary').click();await page.waitForTimeout(350);
 const after=await canvas.screenshot(),a=await sharp(before).removeAlpha().raw().toBuffer({resolveWithObject:true}),b=await sharp(after).removeAlpha().raw().toBuffer({resolveWithObject:true});
 const palette=['c9d5d8','f1f3ee','f2dc4a','e98632','a96bd2','8a72d4','4b72e8','4055bd','d45359','ef655e','75cb58','3d9f62','54c5b0','e78bb2'].map(value=>[0,2,4].map(index=>Number.parseInt(value.slice(index,index+2),16))),candidates=[];let changed=0;for(let y=0;y<a.info.height;y+=2)for(let x=0;x<a.info.width;x+=2){const offset=(y*a.info.width+x)*3,difference=Math.abs(a.data[offset]-b.data[offset])+Math.abs(a.data[offset+1]-b.data[offset+1])+Math.abs(a.data[offset+2]-b.data[offset+2]);if(difference>90)changed++;const color=[a.data[offset],a.data[offset+1],a.data[offset+2]],distance=Math.min(...palette.map(sample=>Math.abs(sample[0]-color[0])+Math.abs(sample[1]-color[1])+Math.abs(sample[2]-color[2])));if(difference>55&&distance<95)candidates.push([x,y,difference-distance]);}
 if(changed<80)throw Error(`Acupoint layer changed only ${changed} sampled pixels`);
 await page.locator('#acupuncture-menu summary').click();await page.locator('#acupuncture-points').click();await page.locator('#acupuncture-menu summary').click();await page.locator('#point-panel-toggle').click();await page.locator('#search').fill('LI4');await page.locator('#structures .point-tile').click();await expect(page.locator('#selection-toggle')).toHaveAttribute('aria-label',/Both sides selected/);await page.waitForTimeout(300);
 const selectedImage=await canvas.screenshot(),selectedPixels=await sharp(selectedImage).removeAlpha().raw().toBuffer({resolveWithObject:true}),green=[];for(let y=0;y<selectedPixels.info.height;y++)for(let x=0;x<selectedPixels.info.width;x++){const offset=(y*selectedPixels.info.width+x)*3,r=selectedPixels.data[offset],g=selectedPixels.data[offset+1],blue=selectedPixels.data[offset+2];if(g>155&&g-r>55&&g-blue>25)green.push([x,y,g-r+g-blue]);}
 green.sort((left,right)=>right[2]-left[2]);const box=await canvas.boundingBox();let selected=false;for(const [x,y] of green.slice(0,800)){await page.mouse.click(box.x+x,box.y+y);if((await page.locator('#selection-toggle').getAttribute('aria-label'))?.includes('location selected')){selected=true;break;}}
 if(!selected)throw Error(`Could not select one highlighted body location from the canvas (${green.length} green candidates)`);
 if(!(await page.locator('#selection-toggle').getAttribute('aria-label'))?.includes('location selected'))throw Error('Canvas point selection did not remain side-specific');
 await expect(page.locator('#selected-info')).toContainText('extracted from the supplied');
 await page.locator('#acupuncture-menu summary').click();await page.locator('#acupuncture-lines').click();await page.locator('#acupuncture-menu summary').click();await page.waitForTimeout(250);
 await page.screenshot({path:'verification/acupuncture-male-points-lines.png'});
 await page.locator('#model-female').click();await expect(page.locator('#loading')).toBeHidden({timeout:180000});await page.waitForTimeout(300);await page.screenshot({path:'verification/acupuncture-female-points-lines.png'});
 await page.setViewportSize({width:390,height:844});await page.locator('#acupuncture-menu summary').click();const mobile=await page.locator('.acupuncture-content').boundingBox();if(!mobile||mobile.x<0||mobile.x+mobile.width>390)throw Error('Acupuncture controls overflow the mobile viewport');if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('Acupuncture controls cause horizontal overflow');await page.screenshot({path:'verification/acupuncture-mobile-controls.png'});
 if(errors.length)throw Error(`Browser errors: ${errors.join(' | ')}`);
 console.log(JSON.stringify({channels:14,changedSamples:changed,pointSelection:selected,maleScreenshot:'verification/acupuncture-male-points-lines.png',femaleScreenshot:'verification/acupuncture-female-points-lines.png',mobileScreenshot:'verification/acupuncture-mobile-controls.png'},null,2));
}finally{await browser.close();}
