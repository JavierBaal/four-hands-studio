import numpy as np, sys
from scipy.io import wavfile
def load(p):
    r,d=wavfile.read(p); return r,d.astype(np.float64)/2147483648.0
r,a=load(sys.argv[1]); _,b=load(sys.argv[2]); n=min(len(a),len(b)); a=a[:n].mean(1); b=b[:n].mean(1)
seg=float(sys.argv[3]); names=sys.argv[4].split(',')
L=int(seg*r)
def db(x): return 20*np.log10(max(np.sqrt((x**2).mean()),1e-9))
def cen(x):
    s=np.abs(np.fft.rfft(x*np.hanning(len(x)))); f=np.fft.rfftfreq(len(x),1/r); return (s*f).sum()/max(s.sum(),1e-12)
for i,nm in enumerate(names):
    x=a[i*L:(i+1)*L]; y=b[i*L:(i+1)*L]
    if len(x)<L: break
    print("%-8s tsf %6.1f dB spessa %6.1f dB diff %+5.1f | centroid tsf %5.0f spessa %5.0f"%(nm,db(x),db(y),db(x)-db(y),cen(x),cen(y)))
