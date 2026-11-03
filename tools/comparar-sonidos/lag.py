import numpy as np, sys
from scipy.io import wavfile
from scipy.signal import correlate
def load(p): r,d=wavfile.read(p); return r,d.astype(np.float64).mean(1)/2147483648.0
r,a=load(sys.argv[1]); _,b=load(sys.argv[2])
for t0 in [float(x) for x in sys.argv[3].split(',')]:
    i=int(t0*r); x=a[i:i+r//4]; y=b[i:i+r//4]
    c=correlate(x,y,mode='full'); lag=np.argmax(c)-(len(y)-1)
    yy=np.roll(b,lag)[i:i+r//4]
    print("t=%.2f lag %+d muestras (%.2f ms); resta/señal tras alinear %.3f" % (t0, lag, lag/r*1000, np.sqrt(((x-yy)**2).mean())/np.sqrt((y**2).mean())))
