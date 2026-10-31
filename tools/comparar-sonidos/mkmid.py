import mido
progs=[0,4,24,32,40,42,48,49,52,56,57,60,61,68,71,73,80,88,89,91,95,46]
mid=mido.MidiFile(ticks_per_beat=480); t=mido.MidiTrack(); mid.tracks.append(t)
t.append(mido.MetaMessage('set_tempo',tempo=500000))
seg=480*8  # 4 s per program at 120 bpm
for i,p in enumerate(progs):
    ch=i%9
    t.append(mido.Message('control_change',channel=ch,control=7,value=100,time=0))
    t.append(mido.Message('control_change',channel=ch,control=91,value=0,time=0))
    t.append(mido.Message('program_change',channel=ch,program=p,time=0))
    for k,(note,vel) in enumerate([(48,40),(55,70),(60,100),(64,127)]):
        t.append(mido.Message('note_on',channel=ch,note=note,velocity=vel,time=0 if k==0 else 0))
        t.append(mido.Message('note_off',channel=ch,note=note,velocity=0,time=480))
    t.append(mido.Message('note_on',channel=ch,note=60,velocity=90,time=0))
    t.append(mido.Message('note_off',channel=ch,note=60,velocity=0,time=480*2))
    t.append(mido.Message('note_on',channel=ch,note=0,velocity=0,time=480*2))
# drums
for k,n in enumerate([36,38,42,46,49,45,51,39]):
    t.append(mido.Message('note_on',channel=9,note=n,velocity=100,time=0 if k==0 else 240))
    t.append(mido.Message('note_off',channel=9,note=n,velocity=0,time=240))
t.append(mido.Message('note_on',channel=0,note=0,velocity=0,time=480*4))
mid.save('progs.mid')
# expression / mod / pedal / reverb test on strings
m2=mido.MidiFile(ticks_per_beat=480); t=mido.MidiTrack(); m2.tracks.append(t)
t.append(mido.Message('program_change',channel=0,program=48,time=0))
t.append(mido.Message('control_change',channel=0,control=91,value=0,time=0))
t.append(mido.Message('note_on',channel=0,note=60,velocity=90,time=0))
for v in range(127,0,-4): t.append(mido.Message('control_change',channel=0,control=11,value=v,time=60))
t.append(mido.Message('control_change',channel=0,control=11,value=127,time=0))
for v in range(0,128,4): t.append(mido.Message('control_change',channel=0,control=1,value=v,time=60))
t.append(mido.Message('note_off',channel=0,note=60,velocity=0,time=0))
t.append(mido.Message('control_change',channel=0,control=1,value=0,time=0))
t.append(mido.Message('program_change',channel=1,program=0,time=0))
t.append(mido.Message('control_change',channel=1,control=64,value=127,time=0))
for n in (60,64,67): t.append(mido.Message('note_on',channel=1,note=n,velocity=90,time=0)); t.append(mido.Message('note_off',channel=1,note=n,velocity=0,time=120))
t.append(mido.Message('control_change',channel=1,control=64,value=0,time=480*4))
t.append(mido.Message('control_change',channel=1,control=91,value=127,time=480))
t.append(mido.Message('note_on',channel=1,note=72,velocity=100,time=0)); t.append(mido.Message('note_off',channel=1,note=72,velocity=0,time=240))
t.append(mido.Message('note_on',channel=1,note=0,velocity=0,time=480*6))
m2.save('ctrl.mid')
