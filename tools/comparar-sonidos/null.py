import numpy as np, sys
from scipy.io import wavfile
def load(p): r,d=wavfile.read(p); return r,d.astype(np.float64)/2147483648.0
r,a=load(sys.argv[1]); _,b=load(sys.argv[2]); n=min(len(a),len(b)); a=a[:n]; b=b[:n]
def db(x): return 20*np.log10(max(np.sqrt((x**2).mean()),1e-12))
print("%-10s motor %.1f dB  spessa %.1f dB  diferencia (resta) %.1f dB  => %.1f dB por debajo" % (sys.argv[3], db(a), db(b), db(a-b), db(b)-db(a-b)))
sec=r; k=n//sec
ea=np.array([np.sqrt((a[i*sec:(i+1)*sec]**2).mean()) for i in range(k)]); eb=np.array([np.sqrt((b[i*sec:(i+1)*sec]**2).mean()) for i in range(k)])
m=(ea>1e-4)&(eb>1e-4); d=20*np.log10(ea[m]/eb[m])
print("           por segundo: mediana %+.2f dB, peor %+.2f / %+.2f dB" % (np.median(d), d.min(), d.max()))
