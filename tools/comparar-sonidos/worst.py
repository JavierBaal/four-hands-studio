import numpy as np, sys
from scipy.io import wavfile
def load(p): r,d=wavfile.read(p); return r,d.astype(np.float64)/2147483648.0
r,a=load(sys.argv[1]); _,b=load(sys.argv[2]); n=min(len(a),len(b)); a=a[:n]; b=b[:n]
w=r//4; k=n//w
for i in range(k):
    x=a[i*w:(i+1)*w]; y=b[i*w:(i+1)*w]
    ex=np.sqrt((x**2).mean()); ey=np.sqrt((y**2).mean()); ed=np.sqrt(((x-y)**2).mean())
    if ey>1e-4 and (abs(20*np.log10(ex/ey))>0.5 or ed/ey>0.3):
        print("t=%5.2fs level %+.2f dB  resta/señal %.2f" % (i*w/r, 20*np.log10(ex/ey), ed/ey))
