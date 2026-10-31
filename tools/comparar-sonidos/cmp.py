import numpy as np, sys
from scipy.io import wavfile
def load(p):
    r,d=wavfile.read(p); d=d.astype(np.float64)
    if d.dtype!=np.float64: pass
    m=np.abs(d).max(); 
    # 24-bit read as int32 scaled
    d=d/2147483648.0 if np.abs(d).max()>10 else d
    return r,d
ra,a=load(sys.argv[1]); rb,b=load(sys.argv[2])
n=min(len(a),len(b)); a=a[:n]; b=b[:n]
def db(x): return 20*np.log10(max(x,1e-9))
for name,x in (("A",a),("B",b)):
    print(name,"rms dB %.1f peak dB %.1f"%(db(np.sqrt((x**2).mean())),db(np.abs(x).max())))
# 1-second loudness envelope
sec=ra; k=n//sec
ea=np.array([np.sqrt((a[i*sec:(i+1)*sec]**2).mean()) for i in range(k)])
eb=np.array([np.sqrt((b[i*sec:(i+1)*sec]**2).mean()) for i in range(k)])
mask=(ea>1e-4)&(eb>1e-4)
d=20*np.log10(ea[mask]/eb[mask])
print("per-second level diff A-B dB: median %.1f, p10 %.1f, p90 %.1f"%(np.median(d),np.percentile(d,10),np.percentile(d,90)))
print("envelope correlation (dB):",np.corrcoef(20*np.log10(ea[mask]),20*np.log10(eb[mask]))[0,1].round(3))
def centroid(x):
    m=x.mean(axis=1) if x.ndim>1 else x
    out=[]
    for i in range(0,len(m)-4096,sec):
        s=np.abs(np.fft.rfft(m[i:i+4096]*np.hanning(4096)))
        f=np.fft.rfftfreq(4096,1/ra)
        if s.sum()>1e-3: out.append((s*f).sum()/s.sum())
    return np.median(out)
print("spectral centroid Hz A %.0f B %.0f"%(centroid(a),centroid(b)))
# stereo width
for name,x in (("A",a),("B",b)):
    mid=(x[:,0]+x[:,1])/2; side=(x[:,0]-x[:,1])/2
    print(name,"side/mid dB %.1f"%(db(np.sqrt((side**2).mean()))-db(np.sqrt((mid**2).mean()))))
