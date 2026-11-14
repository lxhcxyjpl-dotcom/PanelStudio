"""Generate original synthetic inputs for the reproducible PanelStudio showcase."""
from pathlib import Path
import json
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.colors import LinearSegmentedColormap
from matplotlib import font_manager

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[1]
A = ROOT/'assets'
F = REPO/'fonts'
A.mkdir(exist_ok=True)
sources=[]
font_manager.fontManager.addfont(str(F/'NotoSans-Regular.ttf'))
plt.rcParams.update({'font.family':'Noto Sans','font.size':8,'axes.titlesize':10,'axes.labelsize':8,'xtick.labelsize':7,'ytick.labelsize':7,'axes.spines.top':False,'axes.spines.right':False,'axes.linewidth':.6,'axes.edgecolor':'#747474','text.color':'#252525','axes.labelcolor':'#505050','xtick.color':'#666666','ytick.color':'#666666','svg.fonttype':'none','savefig.facecolor':'white','figure.facecolor':'white'})
colors=['#437A7B','#C47755','#758BB3','#BAA46B']
rng=np.random.default_rng(20261113)
clusters=[rng.multivariate_normal(center,cov,160) for center,cov in [((-2.5,1.0),[[.32,.08],[.08,.2]]),((.5,2.1),[[.38,-.15],[-.15,.26]]),((2.5,-.6),[[.2,.04],[.04,.5]]),((-.6,-1.7),[[.45,.12],[.12,.18]])]]
heat=rng.normal(0,.5,(10,8)); heat[:3,:3]+=1.3; heat[3:7,3:6]+=1.15; heat[7:,6:]+=1.2
cmap=LinearSegmentedColormap.from_list('demo',['#477D85','#F4F1EA','#B76D52'])
def clean(ax):
    ax.tick_params(length=2,pad=3)
    return ax
def embedding(ax):
    for i,points in enumerate(clusters): ax.scatter(points[:,0],points[:,1],s=5,color=colors[i],alpha=.72,edgecolors='none',rasterized=False)
    ax.set(xlabel='Embedding 1',ylabel='Embedding 2',title='Synthetic cell map',xticks=[],yticks=[])
    for i,p in enumerate([(-3.5,2),(0,3.3),(2.9,-1.5),(-1.2,-2.6)]): ax.text(*p,f'C{i+1}',color=colors[i],fontsize=8,weight='bold')
def proportion(ax):
    vals=np.array([[.29,.25,.22,.24],[.23,.31,.28,.18],[.35,.21,.25,.19]])
    base=np.zeros(3)
    for i in range(4): ax.bar(np.arange(3),vals[:,i],bottom=base,color=colors[i],width=.58,label=f'C{i+1}'); base+=vals[:,i]
    ax.set(xticks=range(3),xticklabels=['S1','S2','S3'],ylim=(0,1),yticks=[0,.5,1],ylabel='Fraction',title='Cell composition')
def dot(ax):
    values=np.array([[.8,.6,.2,.1],[.2,.9,.4,.1],[.1,.2,.9,.6],[.3,.1,.3,.9]])
    for y in range(4):
        for x in range(4): ax.scatter(x,y,s=22+values[y,x]*130,c=[values[y,x]],vmin=0,vmax=1,cmap=cmap,edgecolors='none')
    ax.set(xticks=range(4),xticklabels=['M1','M2','M3','M4'],yticks=range(4),yticklabels=['C1','C2','C3','C4'],title='Marker pattern',xlim=(-.6,3.6),ylim=(3.6,-.6))
def violin(ax):
    data=[rng.lognormal(mean,.3,50) for mean in [.3,.6,.45,.8]]
    v=ax.violinplot(data,showmedians=True)
    for body,c in zip(v['bodies'],colors): body.set_facecolor(c);body.set_alpha(.65);body.set_edgecolor('none')
    for k in ['cmins','cmaxes','cbars','cmedians']: v[k].set_color('#777777');v[k].set_linewidth(.6)
    ax.set(xticks=[1,2,3,4],xticklabels=['C1','C2','C3','C4'],ylabel='Simulated signal',title='Expression distribution')
def heatmap(ax):
    ax.imshow(heat,cmap=cmap,aspect='auto',vmin=-1.5,vmax=2)
    ax.set(xticks=[0,3,7],xticklabels=['S1','S4','S8'],yticks=[0,4,9],yticklabels=['M1','M5','M10'],title='Marker expression')
    for s in ax.spines.values():s.set_visible(False)
def trend(ax):
    x=np.linspace(0,1,60)
    for i,c in enumerate(colors[:3]):
        y=.15+i*.12+(.6-i*.13)/(1+np.exp(-(x-(.3+i*.1))*9))
        ax.plot(x,y,color=c,lw=1.5);ax.fill_between(x,y-.035,y+.035,color=c,alpha=.12,lw=0)
    ax.set(xlabel='Simulated progression',ylabel='Normalized signal',xticks=[0,.5,1],title='Illustrative trajectories')
draws=[embedding,proportion,dot,violin,heatmap,trend]
for letter,draw in zip('abcdef',draws):
    fig,ax=plt.subplots(figsize=(3.7,2.65));draw(clean(ax));fig.tight_layout(pad=1.1)
    for ext in ['svg','png']:fig.savefig(A/f'panel-{letter}.{ext}',dpi=150)
    plt.close(fig)
def finish(fig,name,subtitle):
    fig.suptitle(subtitle,x=.055,y=.99,ha='left',fontsize=11,weight='medium')
    fig.text(.055,.015,'ORIGINAL SYNTHETIC DEMO DATA  /  No experimental or clinical findings',fontsize=7,color='#666666')
    for ext in ['svg','png']:fig.savefig(A/f'{name}.{ext}',dpi=160)
    plt.close(fig)
fig,axs=plt.subplots(2,3,figsize=(10.4,6.8));fig.subplots_adjust(left=.085,right=.97,top=.89,bottom=.12,hspace=.58,wspace=.5)
for letter,ax,draw in zip('ABCDEF',axs.flat,draws): draw(clean(ax));ax.text(-.22,1.14,letter,transform=ax.transAxes,fontsize=12,weight='bold')
finish(fig,'single-cell','Single-cell figure  /  simulated populations')
fig,axs=plt.subplots(1,3,figsize=(10.4,4.1));fig.subplots_adjust(left=.08,right=.97,top=.80,bottom=.24,wspace=.53)
for letter,ax,draw in zip('ABC',axs,[heatmap,dot,trend]):draw(clean(ax));ax.text(-.22,1.13,letter,transform=ax.transAxes,fontsize=12,weight='bold')
finish(fig,'molecular','Molecular figure  /  simulated expression patterns')
grid=np.mgrid[0:180,0:240];yy,xx=grid
image=np.zeros((180,240,3));positions=rng.uniform([15,15],[225,165],(32,2))
for x,y in positions:
    nucleus=np.exp(-((xx-x)**2+(yy-y)**2)/(2*4**2))
    shell=np.exp(-((np.sqrt((xx-x)**2+(yy-y)**2)-7)**2)/(2*1.8**2))
    image[:,:,2]+=nucleus*.75;image[:,:,1]+=shell*.65;image[:,:,0]+=nucleus*.1
image=np.clip(image+rng.uniform(0,.035,image.shape),0,1)
fig,axs=plt.subplots(1,3,figsize=(10.4,4.1));fig.subplots_adjust(left=.055,right=.97,top=.8,bottom=.2,wspace=.15)
for letter,ax,title,im in zip('ABC',axs,['Synthetic nuclei','Synthetic membrane','Composite'],[image*np.array([0,0,1]),image*np.array([0,1,0]),image]):
    ax.imshow(im);ax.set_title(title);ax.axis('off');ax.text(0,1.13,letter,transform=ax.transAxes,fontsize=12,weight='bold')
from PIL import Image
for channel,im in [('blue',image*np.array([0,0,1])),('green',image*np.array([0,1,0])),('merged',image)]: Image.fromarray((im*255).astype('uint8')).save(A/f'microscopy-{channel}.png')
finish(fig,'microscopy','Microscopy figure  /  procedural fluorescence; no calibrated scale')
fig,axs=plt.subplots(1,3,figsize=(10.4,4.1));fig.subplots_adjust(left=.08,right=.97,top=.8,bottom=.24,wspace=.5)
blot=np.ones((80,140))*.96
for i,amp in enumerate([.45,.65,.30,.72]):
    band=np.exp(-((np.arange(140)[None,:]-(20+i*30))/9)**6)*np.exp(-((np.arange(80)[:,None]-25)/2.5)**2)
    blot-=amp*band
    blot-=.5*np.exp(-((np.arange(140)[None,:]-(20+i*30))/9)**6)*np.exp(-((np.arange(80)[:,None]-60)/2.5)**2)
axs[0].imshow(blot,cmap='gray',vmin=0,vmax=1);axs[0].axis('off');axs[0].set_title('Schematic bands')
for i,mu in enumerate([.9,1.4]):
    vals=rng.normal(mu,.13,6);axs[1].bar(i,vals.mean(),color=colors[i],width=.55,alpha=.7);axs[1].scatter(i+rng.uniform(-.12,.12,6),vals,c='#333333',s=13,zorder=3)
axs[1].set(xticks=[0,1],xticklabels=['Demo A','Demo B'],ylabel='Simulated signal',title='Synthetic replicates')
trend(axs[2])
plt.imsave(A/'experimental-bands.png',blot,cmap='gray',vmin=0,vmax=1)
fig.canvas.draw()
barfig,barax=plt.subplots(figsize=(3.7,2.65))
for i,values in enumerate([[.82,.96,.91,1.03,.88,.94],[1.26,1.44,1.35,1.51,1.38,1.42]]):
    barax.bar(i,np.mean(values),color=colors[i],width=.55,alpha=.7)
    barax.scatter(i+np.linspace(-.1,.1,6),values,c='#333333',s=13,zorder=3)
barax.set(xticks=[0,1],xticklabels=['Demo A','Demo B'],ylabel='Simulated signal',title='Synthetic replicates')
barfig.tight_layout(pad=1.1);barfig.savefig(A/'experimental-bars.svg');plt.close(barfig)
for letter,ax in zip('ABC',axs):ax.text(-.18,1.13,letter,transform=ax.transAxes,fontsize=12,weight='bold')
finish(fig,'experimental','Experimental figure  /  illustrative bands and simulated values')
(A/'logo.svg').write_text('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><title>PanelStudio panel composition mark</title><path fill="#252525" d="M3 3h12v26H3zM18 3h11v12H18z"/><path fill="#C47755" d="M18 18h11v11H18z"/></svg>',encoding='utf-8')
(A/'DATA-NOTES.md').write_text('''# 合成科研示例\n\n全部图形由 generate.py 原创生成，随机种子 20261113，无患者或实验数据。\n\n- 单细胞：二维高斯分布模拟群体，UMAP 风格示意；没有运行 UMAP、聚类或差异分析。\n- 分子图：随机生成热图和点图，Marker M1–M10 为占位名称。\n- 显微图：解析高斯核与圆环生成荧光示意，没有显微采集；没有校准比例尺。\n- 实验图：Western blot 样式示意条带与合成散点，不是实验测量，没有推断检验或显著性宣称。\n\nSVG 保留文本和矢量对象；显微像素嵌入 SVG。此处保留原始合成输入和绘图概览。首页使用 scripts/build-showcase.mjs 经真实导入、排版、事务、导出与工程包重开流程生成的 apps/web/public/showcase 内容。首页演示是已记录命令的回放，不实时调用 AI。示例本身未逐张进行 Illustrator 人工验收。原始数据颜色与 UI 主题独立。\n\n本次原创图形与脚本按 MIT 提供，第三方字体保留各自 OFL 文件。\n''',encoding='utf-8')
print(json.dumps({'assets':len(list(A.iterdir())),'font_sources':sources},ensure_ascii=False))
