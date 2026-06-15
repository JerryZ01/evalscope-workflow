import json
import urllib.request

url='http://localhost:5801/api/catalog/datasets'
with urllib.request.urlopen(url, timeout=30) as r:
    data=json.loads(r.read().decode('utf-8'))

vision=[]
for ds in data.get('datasets',[]):
    tags=[t.lower() for t in ds.get('tags',[])]
    if any(k in tags for k in ['vision','multimodal','image','vlm']):
        vision.append((ds['name'], ds.get('pretty_name',''), ds.get('tags',[])))

print('total', data.get('total'))
print('vision_like', len(vision))
for x in vision[:30]:
    print(x)
