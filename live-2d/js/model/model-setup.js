const { EmotionMotionMapper } = require('../ui/emotion-motion-mapper.js');
const { EmotionExpressionMapper } = require('../ui/emotion-expression-mapper.js');
const { MusicPlayer } = require('../services/music-player.js');

class ModelSetup {
    static async initialize(modelController, config, ttsEnabled, asrEnabled, ttsProcessor, voiceChat) {
        const app = new PIXI.Application({
            view: document.getElementById('canvas'),
            autoStart: true,
            transparent: true,
            autoDensity: true,
            antialias: true,
            preserveDrawingBuffer: true,
            resolution: window.devicePixelRatio || 1,
            width: window.innerWidth,
            height: window.innerHeight
        });

        const model = await PIXI.live2d.Live2DModel.from('2D/肥牛/feiniu.model3.json');
        app.stage.addChild(model);

        const showModel = config.ui?.show_model !== false;
        model.visible = showModel;
        console.log(`模型显示状态: ${showModel ? '显示' : '隐藏'}`);

        modelController.init(model, app, config);
        await modelController.setupInitialModelProperties(config.ui?.model_scale || 2.3);

        const emotionMapper = new EmotionMotionMapper(model);
        global.currentCharacterName = await emotionMapper.getCurrentCharacterName();
        global.emotionMapper = emotionMapper;

        const expressionMapper = new EmotionExpressionMapper(model);
        global.currentCharacterName = await expressionMapper.getCurrentCharacterName();
        global.expressionMapper = expressionMapper;

        if (ttsEnabled && ttsProcessor.setEmotionMapper) {
            ttsProcessor.setEmotionMapper(emotionMapper);
        }

        if (ttsEnabled && ttsProcessor.setExpressionMapper) {
            ttsProcessor.setExpressionMapper(expressionMapper);
        }

        const musicPlayer = new MusicPlayer(modelController);
        musicPlayer.setEmotionMapper(emotionMapper);
        global.musicPlayer = musicPlayer;

        voiceChat.setModel(model);
        voiceChat.setEmotionMapper = emotionMapper;

        return { app, model, emotionMapper, expressionMapper, musicPlayer };
    }
}

module.exports = { ModelSetup };
