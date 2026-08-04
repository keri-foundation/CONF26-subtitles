# Gegevens

## De huidige workflow

2026-05-16 08:31:39

Op dit moment doe ik het als volgt: 
Ik ga niet meer downloaden van youtube, maar de map `original` is nu uitgangspunt
hier mag ik in editen, en dan de npm run fix eroverheen halen
echter het script is niet helemaal idempotent, dus niet twee keer de vervangingsscript runnen
dus handmatig vervangingen in original doen en dan npm run fix en dan de volgende keer weer original gebruiken
DUS NIET de bestanden uit fixed overkopieren naar original


## Credentials YouTube API

### Algemeen

https://console.cloud.google.com/apis/credentials?project=keri-foundation

### Onvindbaar zonder directe link

https://console.cloud.google.com/iam-admin/quotas

https://console.cloud.google.com/iam-admin/quotas?project=keri-foundation&pageState=(%22allQuotasTable%22:(%22f%22:%22%255B%257B_22k_22_3A_22Service_22_2C_22t_22_3A10_2C_22v_22_3A_22_5C_22YouTube%2520Data%2520API%2520v3_5C_22_22_2C_22s_22_3Atrue_2C_22i_22_3A_22serviceTitle_22%257D%255D%22))

## Playlists URLs

Playlist Url Day 1

https://www.youtube.com/playlist?list=PLnHy2ee5UksOfPng7BGEN-XNVupzXpgSL


Playlist Url Day 2

https://www.youtube.com/playlist?list=PLnHy2ee5UksMjwBseKJ7ivXiYukRvI65a


## Day 1


### Download

```bash
npm run empty-subtitles && npm run download "https://www.youtube.com/playlist?list=PLnHy2ee5UksOfPng7BGEN-XNVupzXpgSL"
```

### Fix

```bash
npm run fix
```

### Upload

```bash
npm run upload -- "https://www.youtube.com/playlist?list=PLnHy2ee5UksOfPng7BGEN-XNVupzXpgSL"
```

### One strike

```bash
npm run empty-subtitles && npm run download "https://www.youtube.com/playlist?list=PLnHy2ee5UksOfPng7BGEN-XNVupzXpgSL" && npm run fix && npm run upload -- "https://www.youtube.com/playlist?list=PLnHy2ee5UksOfPng7BGEN-XNVupzXpgSL"
```

## Day 2

### Download


```bash
npm run empty-subtitles && npm run download "https://www.youtube.com/playlist?list=PLnHy2ee5UksMjwBseKJ7ivXiYukRvI65a"
```

### Upload

```bash
npm run upload -- "https://www.youtube.com/playlist?list=PLnHy2ee5UksMjwBseKJ7ivXiYukRvI65a"
```


